import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TurnChunk, TurnRequest } from '@morrowbot/contracts';
import { standaloneRuntime, type ProviderPlugin } from '@morrowbot/plugin-sdk';
import { BUILTIN_PROVIDERS } from '@morrowbot/providers';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FAKE_AGY } from '../../testing/agy-fixture.ts';

let home: string;
let provider: ProviderPlugin;

beforeEach(async () => {
  home = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-agy-')));
  const adapter = BUILTIN_PROVIDERS.find((entry) => entry.manifest.id === 'provider-antigravity');
  if (adapter === undefined) throw new Error('provider-antigravity is not built in');
  provider = adapter.create(standaloneRuntime({ env: { ...process.env, HOME: home }, platform: 'darwin' }));
  await mkdir(path.join(home, 'data'), { recursive: true });
  await provider.init?.({ config: { cliPath: FAKE_AGY }, dataDir: path.join(home, 'data') });
  await provider.providerInfo({ refresh: true });
});

afterEach(async () => {
  await provider.shutdown?.();
  await rm(home, { recursive: true, force: true });
});

function request(session: TurnRequest['session'], prompt: string): TurnRequest {
  return {
    turnId: 'turn-1',
    cwd: home,
    mode: 'interactive',
    access: 'read-only',
    vendorSettings: 'personal',
    expectedAccountKey: '',
    expectedRouteKey: '',
    selection: { kind: 'default' },
    session,
    system: null,
    prompt,
    images: [],
    hostTools: { kind: 'none' },
  };
}

async function turn(session: TurnRequest['session'], prompt: string): Promise<unknown> {
  const chunks: TurnChunk[] = [];
  const end = await provider.turn({
    request: request(session, prompt),
    signal: new AbortController().signal,
    emit: (chunk) => {
      chunks.push(chunk);
    },
    ask: () => Promise.reject(new Error('no approvals in this test')),
    onSteer: () => undefined,
  });
  return { outcome: end.outcome, chunks: chunks.filter((chunk) => chunk.kind !== 'model-options-changed') };
}

it('resumes a session through session/load without replaying its history into the turn', async () => {
  expect(await turn({ kind: 'resume', ref: 'sess-old' }, 'hello')).toMatchInlineSnapshot(`
    {
      "chunks": [
        {
          "kind": "text",
          "text": "Echo: ",
        },
        {
          "kind": "text",
          "text": "hello",
        },
      ],
      "outcome": {
        "finishReason": "stop",
        "kind": "completed",
      },
    }
  `);
});
