import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentList, InviteResponse, PairingCodeResponse } from '@morrowbot/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { startMemberKit, type MemberKit } from '../../../host/src/testing/member-kit.ts';
import type { HostSupervisor } from '../main/host-supervisor.ts';
import { proxyRequest, type HostTarget, type IpcSender } from '../main/ipc-proxy.ts';
import { pickServer } from '../main/join-server.ts';
import { readServerChoice, serverPlanOf, writeServerChoice } from '../main/server-choice.ts';
import { openServerConnection } from '../main/server-connection.ts';

const RENDERER_URL = 'file:///Applications/MorrowBot.app/Contents/Resources/app/dist/renderer/index.html';
const PAGE: IpcSender = { kind: 'frame', url: RENDERER_URL, isMainFrame: true };

let kit: MemberKit;
let desktopDir: string;
beforeEach(async () => {
  kit = await startMemberKit();
  desktopDir = await mkdtemp(path.join(tmpdir(), 'morrowbot-client-only-'));
});
afterEach(async () => {
  await kit.close();
  await rm(desktopDir, { recursive: true, force: true });
});

/** Every local host the app would start. A client-only launch must start none. */
function localStarts(): { readonly started: string[]; readonly startLocal: () => HostSupervisor } {
  const started: string[] = [];
  return {
    started,
    startLocal: () => {
      started.push('local host');
      return { target: () => undefined, stop: () => Promise.resolve() };
    },
  };
}

/** The test server's address, which changes each run, as `<server>`. */
function withoutPort(value: unknown): unknown {
  const text: unknown = JSON.parse(JSON.stringify(value).replaceAll(kit.chat.host.url, '<server>'));
  return text;
}

async function agentNames(target: HostTarget | undefined): Promise<unknown> {
  const reply = await proxyRequest({ sender: PAGE, rendererUrl: RENDERER_URL, input: { method: 'GET', path: '/api/agents' }, host: target });
  return reply.status === 200 ? AgentList.parse(reply.body).agents.map(({ name }) => name) : reply;
}

it('joins a server from an invite link on first launch, starts no local host then or on the next launch, and sees only what it was shared', async () => {
  const shared = await kit.named('Shared');
  await kit.named('Hidden');
  const access = { kind: 'scoped', agents: [{ agentId: shared.agent.id, canEdit: false, workspace: 'read-only' }] };
  const invite = InviteResponse.parse((await kit.chat.host.call('POST', '/api/members/invites', { name: 'Guest', access, url: kit.chat.host.url })).body);
  const firstPlan = serverPlanOf(readServerChoice(desktopDir), desktopDir);

  const picked = await pickServer({ kind: 'join', link: invite.inviteUri, url: '', code: '' }, 'darwin');
  if (picked.kind !== 'picked') throw new Error(picked.message);
  const first = localStarts();
  const firstRun = openServerConnection(firstPlan, { startLocal: first.startLocal, connectRemote: () => undefined });
  writeServerChoice(desktopDir, picked.choice);
  const tookChoice = firstRun.choose(picked.choice);

  const nextPlan = serverPlanOf(readServerChoice(desktopDir), desktopDir);
  const next = localStarts();
  const connected: string[] = [];
  const nextRun = openServerConnection(nextPlan, { startLocal: next.startLocal, connectRemote: (target) => connected.push(target.url) });
  const switchLive = nextRun.choose({ kind: 'local' });
  await nextRun.stop();

  expect(withoutPort({
    firstPlan,
    tookChoice,
    firstRunMode: firstRun.mode(),
    firstRunAgents: await agentNames(firstRun.target()),
    nextPlan: nextPlan.kind,
    nextRunMode: nextRun.mode(),
    nextRunAgents: await agentNames(nextRun.target()),
    eventsFollowed: connected,
    localHostsStarted: [...first.started, ...next.started],
    switchToLocalWithoutRelaunch: switchLive,
    tokenFileMode: ((await stat(path.join(desktopDir, 'server.json'))).mode & 0o777).toString(8),
    sameInviteAgain: await pickServer({ kind: 'join', link: invite.inviteUri, url: '', code: '' }, 'darwin'),
  })).toMatchInlineSnapshot(`
    {
      "eventsFollowed": [
        "<server>",
      ],
      "firstPlan": {
        "kind": "ask",
      },
      "firstRunAgents": [
        "Shared",
      ],
      "firstRunMode": {
        "hostName": "Studio Host",
        "kind": "remote",
        "url": "<server>",
      },
      "localHostsStarted": [],
      "nextPlan": "remote",
      "nextRunAgents": [
        "Shared",
      ],
      "nextRunMode": {
        "hostName": "Studio Host",
        "kind": "remote",
        "url": "<server>",
      },
      "sameInviteAgain": {
        "kind": "failed",
        "message": "This invite is wrong, used, expired or revoked. Ask for a new one.",
      },
      "switchToLocalWithoutRelaunch": false,
      "tokenFileMode": "600",
      "tookChoice": true,
    }
  `);
});

it("joins the owner's own server with a pairing code typed beside its address, and keeps running a local server that already has data", async () => {
  const code = PairingCodeResponse.parse((await kit.chat.host.call('POST', '/api/pairing/codes', { url: kit.chat.host.url })).body).code;
  await kit.named('Mine');
  const picked = await pickServer({ kind: 'join', link: '', url: kit.chat.host.url, code: `${code.slice(0, 3)} ${code.slice(3)}` }, 'darwin');
  const upgraded = await mkdtemp(path.join(tmpdir(), 'morrowbot-upgraded-'));
  await writeFile(path.join(upgraded, 'morrowbot.sqlite'), '');
  const local = localStarts();
  const localRun = openServerConnection(serverPlanOf(readServerChoice(upgraded), upgraded), { startLocal: local.startLocal, connectRemote: () => undefined });
  await rm(upgraded, { recursive: true, force: true });

  expect({
    pairedAgents: picked.kind === 'picked' && picked.choice.kind === 'remote' ? await agentNames({ url: picked.choice.url, token: picked.choice.token }) : picked,
    upgradedMode: localRun.mode(),
    localHostsStarted: local.started,
    badLink: await pickServer({ kind: 'join', link: 'https://example.com/join', url: '', code: '' }, 'darwin'),
    badCode: await pickServer({ kind: 'join', link: '', url: kit.chat.host.url, code: 'abc' }, 'darwin'),
    unreachable: await pickServer({ kind: 'join', link: '', url: 'http://127.0.0.1:9', code: '123456' }, 'darwin'),
  }).toMatchInlineSnapshot(`
    {
      "badCode": {
        "kind": "failed",
        "message": "Enter the invite code or 6-digit pairing code",
      },
      "badLink": {
        "kind": "failed",
        "message": "Paste a morrowbot://join link",
      },
      "localHostsStarted": [
        "local host",
      ],
      "pairedAgents": [
        "Mine",
      ],
      "unreachable": {
        "kind": "failed",
        "message": "Couldn't reach http://127.0.0.1:9. Check the address and that this computer can reach the server.",
      },
      "upgradedMode": {
        "kind": "local",
      },
    }
  `);
});
