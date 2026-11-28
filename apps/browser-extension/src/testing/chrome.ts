import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { BrowserTab } from '@morrowbot/contracts';
import { BrowserFailure, type CdpSession } from '../cdp/session.ts';
import type { TabsApi } from '../core/driver.ts';

/** A headless Chrome driven over its DevTools WebSocket, standing in for `chrome.tabs` and `chrome.debugger`. */
export interface ChromeUnderTest {
  readonly tabs: TabsApi;
  readonly attach: (tabId: number) => Promise<CdpSession>;
  /** Evaluates `expression` in the tab through a session of its own, to check what the page saw. */
  evaluate(tabId: number, expression: string): Promise<unknown>;
  close(): Promise<void>;
}

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** `CHROME_PATH`, or a usual install location. CI (ubuntu-latest) ships Chrome, so tests fail there rather than skip. */
export function findChrome(): string | null {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

export const chromeMissing = findChrome() === null && process.env.CI === undefined;

const Reply = z.object({ id: z.number(), result: z.unknown().optional(), error: z.object({ message: z.string() }).optional() });
const Event = z.object({ method: z.string(), params: z.unknown(), sessionId: z.string().optional() });
const TargetInfo = z.object({ targetId: z.string(), type: z.string(), url: z.string(), title: z.string() });

export async function launchChrome(): Promise<ChromeUnderTest> {
  const executable = findChrome();
  if (executable === null) throw new Error('No Chrome found; set CHROME_PATH');
  const profile = await mkdtemp(path.join(tmpdir(), 'orikami-chrome-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    'about:blank',
  ];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const child = spawn(executable, args, { stdio: 'ignore' });
  const socket = new WebSocket(await devtoolsUrl(profile, child));
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => {
      resolve();
    };
    socket.onerror = () => {
      reject(new Error('Could not reach Chrome DevTools'));
    };
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const listeners = new Map<string, Map<string, Set<(params: unknown) => void>>>();
  socket.onmessage = (message: MessageEvent) => {
    const json: unknown = JSON.parse(String(message.data));
    const reply = Reply.safeParse(json);
    if (reply.success) {
      const waiting = pending.get(reply.data.id);
      pending.delete(reply.data.id);
      if (reply.data.error !== undefined) waiting?.reject(new Error(reply.data.error.message));
      else waiting?.resolve(reply.data.result ?? {});
      return;
    }
    const event = Event.parse(json);
    for (const listener of listeners.get(event.sessionId ?? '')?.get(event.method) ?? []) listener(event.params);
  };
  const send = (method: string, params: Readonly<Record<string, unknown>> = {}, sessionId?: string): Promise<unknown> => {
    const id = nextId++;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  const ids = new Map<string, number>();
  const targets = new Map<number, string>();
  const numberOf = (targetId: string): number => {
    const known = ids.get(targetId);
    if (known !== undefined) return known;
    const fresh = ids.size + 1;
    ids.set(targetId, fresh);
    targets.set(fresh, targetId);
    return fresh;
  };
  const targetOf = (tabId: number): string => {
    const targetId = targets.get(tabId);
    if (targetId === undefined) throw new BrowserFailure('no-such-tab', `No tab ${String(tabId)}.`);
    return targetId;
  };
  const list = async (): Promise<BrowserTab[]> => {
    const { targetInfos } = z.object({ targetInfos: z.array(TargetInfo) }).parse(await send('Target.getTargets'));
    return targetInfos
      .filter((info) => info.type === 'page')
      .map((info) => ({ tabId: numberOf(info.targetId), windowId: 1, url: info.url, title: info.title, active: false, status: 'complete' }));
  };

  const tabs: TabsApi = {
    list,
    get: async (tabId) => {
      const found = (await list()).find((tab) => tab.tabId === tabId);
      if (found === undefined) throw new BrowserFailure('no-such-tab', `No tab ${String(tabId)}.`);
      return found;
    },
    createInBackground: async () => {
      const { targetId } = z.object({ targetId: z.string() }).parse(await send('Target.createTarget', { url: 'about:blank', background: true }));
      const tab = (await list()).find((candidate) => candidate.tabId === numberOf(targetId));
      if (tab === undefined) throw new Error('The new tab vanished');
      return tab;
    },
    activate: async (tabId) => {
      await send('Target.activateTarget', { targetId: targetOf(tabId) });
    },
    close: async (tabId) => {
      await send('Target.closeTarget', { targetId: targetOf(tabId) });
    },
  };

  const attach = async (tabId: number): Promise<CdpSession> => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(await send('Target.attachToTarget', { targetId: targetOf(tabId), flatten: true }));
    const events = new Map<string, Set<(params: unknown) => void>>();
    listeners.set(sessionId, events);
    return {
      send: (method, params) => send(method, params, sessionId),
      on: (method, listener) => {
        const set = events.get(method) ?? new Set();
        set.add(listener);
        events.set(method, set);
        return () => set.delete(listener);
      },
    };
  };

  return {
    tabs,
    attach,
    evaluate: async (tabId, expression) => {
      const { sessionId } = z.object({ sessionId: z.string() }).parse(await send('Target.attachToTarget', { targetId: targetOf(tabId), flatten: true }));
      try {
        const { result } = z
          .object({ result: z.object({ value: z.unknown() }) })
          .parse(await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId));
        return result.value;
      } finally {
        await send('Target.detachFromTarget', { sessionId }).catch(() => undefined);
      }
    },
    close: async () => {
      socket.close();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        const killer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, 5_000);
        try {
          await exited;
        } finally {
          clearTimeout(killer);
        }
      }
      await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },
  };
}

async function devtoolsUrl(profile: string, child: ChildProcess): Promise<string> {
  const file = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited with ${String(child.exitCode)}`);
    const text = await readFile(file, 'utf8').catch(() => '');
    const [port, browserPath] = text.split('\n');
    if (port !== undefined && port !== '' && browserPath !== undefined && browserPath !== '') return `ws://127.0.0.1:${port}${browserPath}`;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Chrome did not open its DevTools port');
}
