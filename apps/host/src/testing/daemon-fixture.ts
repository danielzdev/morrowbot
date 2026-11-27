import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderBinding } from '@morrowbot/contracts';
import { z } from 'zod';
import { systemProbe, type ChildGroupRow, type ProcessProbe } from '../features/plugins/index.ts';
import { startChatFixture, type ChatFixture } from './chat-fixture.ts';
import type { TestHostOptions } from './test-host.ts';

/** A plugins folder holding only `daemon`: a provider backed by one shared daemon process. */
export const DAEMON_FIXTURES = fileURLToPath(new URL('../features/plugins/daemon-fixtures', import.meta.url));

export const DAEMON: Extract<ProviderBinding, { kind: 'bound' }> = {
  kind: 'bound',
  pluginId: 'daemon',
  selection: { kind: 'default' },
  access: 'read-only',
  vendorSettings: 'isolated',
};

export type DaemonFlag = 'pause-info' | 'pause-route' | 'pause-usage' | 'hang-info' | 'signed-out' | 'sessions';

export interface DaemonFixture extends ChatFixture {
  /** What the plugin did, from its `events.jsonl`, one short line each. */
  daemonEvents(): Promise<string[]>;
  /** The SIGTERMs its daemons received. */
  signals(): Promise<string[]>;
  setFlag(flag: DaemonFlag, on: boolean): Promise<void>;
  /** The plugin's daemon rows: blocked or live, and the turns linked to each. */
  daemonRows(): { readonly state: 'blocked' | 'live'; readonly generationIds: readonly string[] }[];
  /** The pgid of the plugin's live daemon. */
  daemonPgid(): number;
  /** The pid of the plugin's current worker process. */
  workerPid(): Promise<number>;
}

/** A chat host whose only plugin is the `daemon` fixture. */
export async function startDaemonFixture(options: Partial<TestHostOptions> = {}): Promise<DaemonFixture> {
  const chat = await startChatFixture({ ...options, pluginsDir: DAEMON_FIXTURES });
  const dir = path.join(chat.dataDir, 'plugin-data', 'daemon');
  const lines = async (name: string): Promise<string[]> =>
    existsSync(path.join(dir, name)) ? (await readFile(path.join(dir, name), 'utf8')).split('\n').filter((line) => line !== '') : [];
  return {
    ...chat,
    agent: (binding = DAEMON) => chat.agent(binding),
    daemonEvents: async () =>
      (await lines('events.jsonl')).map((line) =>
        Object.values(z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
          .map((value) => String(value))
          .join(' '),
      ),
    signals: () => lines('daemon-signals'),
    setFlag: async (flag, on) => {
      await mkdir(dir, { recursive: true });
      if (on) await writeFile(path.join(dir, flag), '');
      else await rm(path.join(dir, flag), { force: true });
    },
    daemonRows: () => {
      const { groups } = chat.host.host.plugins;
      const view = (state: 'blocked' | 'live') => (row: ChildGroupRow) => ({ state, generationIds: row.generationIds });
      return [...groups.blockedRows('daemon').map(view('blocked')), ...groups.daemons('daemon').map(view('live'))];
    },
    daemonPgid: () => {
      const [row] = chat.host.host.plugins.groups.daemons('daemon');
      if (row === undefined) throw new Error('no live daemon');
      return row.pgid;
    },
    workerPid: async () => Number(await readFile(path.join(dir, 'worker.pid'), 'utf8')),
  };
}

/** Polls `check` every 20 ms until it holds. */
export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * The real probe, except that a stuck group looks alive (its leader as the real probe reads it)
 * while its `holds` says so. `seen` lists what each probe of a stuck group answered, repeats dropped.
 */
export function stickyProbe(): { readonly probe: ProcessProbe; stick(pgid: number, holds: () => boolean): void; readonly seen: string[] } {
  const stuck = new Map<number, () => boolean>();
  const seen: string[] = [];
  const note = (answer: string): void => {
    if (seen.at(-1) !== answer) seen.push(answer);
  };
  return {
    probe: {
      signalGroup: (pgid) => {
        const holds = stuck.get(pgid);
        if (holds === undefined) return systemProbe.signalGroup(pgid);
        const answer = holds() ? 'alive' : systemProbe.signalGroup(pgid);
        note(answer);
        return answer;
      },
      leader: (pid) => systemProbe.leader(pid),
      bootId: () => systemProbe.bootId(),
    },
    stick: (pgid, holds) => {
      stuck.set(pgid, holds);
    },
    seen,
  };
}

/** Whether a process is running (signal 0). */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
