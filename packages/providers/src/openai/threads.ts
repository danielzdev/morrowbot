import type { ProviderError, TurnSession, z } from '@morrowbot/plugin-sdk';
import type { Call, CodexDaemon } from './daemon.ts';
import { checkThread, policyKey, threadConfig, type ThreadPolicy } from './lockdown.ts';
import { ThreadLoadedListResponse, ThreadOpened, ThreadUnsubscribed } from './protocol.ts';

const OPEN_MS = 30_000;
const LIST_MS = 5_000;
const UNLOAD_MS = 3_000;
const UNLOAD_POLL_MS = 100;
const PAGE_SIZE = 500;
const MAX_PAGES = 20;
const SESSION_GONE = /not found|no rollout|does not exist|unknown thread|no such/i;

export type Opened =
  | { readonly kind: 'opened'; readonly threadId: string; readonly isNew: boolean; readonly model: string | null }
  | { readonly kind: 'refused'; readonly error: ProviderError };

interface OpenRequest {
  readonly cwd: string;
  readonly session: TurnSession;
  /** A stateless thread that Codex keeps in memory only. */
  readonly ephemeral: boolean;
  readonly routeKey: string;
  readonly policy: ThreadPolicy;
  /** The agent's SOUL.md, sent as the thread's developer instructions: Codex loads only AGENTS.md files by itself. */
  readonly instructions: string;
}

/**
 * Starts the turn's thread, or resumes it. A thread already loaded in this daemon is reused only when
 * it was loaded on the same route with the same policy and instructions, because a running thread ignores new
 * overrides. Otherwise it is unloaded first, and resumed only once the daemon no longer lists it.
 * Every opened thread is checked against the daemon's own report before any prompt is sent.
 */
export async function openThread(daemon: CodexDaemon, request: OpenRequest): Promise<Opened> {
  const { policy, routeKey, cwd } = request;
  const soul = request.instructions.trim();
  const key = JSON.stringify([policyKey(policy, cwd), soul]);
  const overrides = {
    cwd,
    modelProvider: policy.modelProvider,
    sandbox: policy.sandbox,
    approvalPolicy: policy.approvalPolicy,
    config: threadConfig(policy),
    developerInstructions: soul === '' ? null : soul,
  };
  if (request.session.kind === 'new') {
    const started = await daemon.call('thread/start', { ...overrides, ephemeral: request.ephemeral }, ThreadOpened, OPEN_MS);
    if (started.kind !== 'ok') return refused(other('start a thread', started));
    return admit(daemon, started.value, policy, { isNew: true, keep: !request.ephemeral, routeKey, policyKey: key });
  }
  const ref = request.session.ref;
  const loaded = daemon.loaded.get(ref);
  if (loaded !== undefined && loaded.routeKey === routeKey && loaded.policyKey === key) {
    return { kind: 'opened', threadId: ref, isNew: false, model: loaded.model };
  }
  daemon.loaded.delete(ref);
  const unloaded = await unload(daemon, ref);
  switch (unloaded) {
    case 'unloaded':
      break;
    case 'unknown':
      return refused({ kind: 'transient', retryAfterMs: null });
    case 'stuck':
      return refused(
        loaded !== undefined && loaded.routeKey !== routeKey
          ? { kind: 'route-changed' }
          : { kind: 'access-not-supported', reason: 'Codex kept an earlier copy of this chat loaded, so Ori Kami cannot apply its access settings. Try again shortly.' },
      );
  }
  const resumed = await daemon.call('thread/resume', { threadId: ref, ...overrides, excludeTurns: true }, ThreadOpened, OPEN_MS);
  if (resumed.kind === 'error' && SESSION_GONE.test(resumed.message)) return refused({ kind: 'session-lost' });
  if (resumed.kind !== 'ok') return refused(other('resume the thread', resumed));
  return admit(daemon, resumed.value, policy, { isNew: false, keep: true, routeKey, policyKey: key });
}

/** Lets a thread go: an unloaded thread costs the daemon nothing. Resolves once Codex answered (or did not). */
export async function releaseThread(daemon: CodexDaemon, threadId: string): Promise<void> {
  daemon.loaded.delete(threadId);
  await daemon.call('thread/unsubscribe', { threadId }, ThreadUnsubscribed, LIST_MS).catch((error: unknown) => {
    console.error('provider-openai: could not unsubscribe a thread', error);
  });
}

async function admit(
  daemon: CodexDaemon,
  opened: ThreadOpened,
  policy: ThreadPolicy,
  entry: { readonly isNew: boolean; readonly keep: boolean; readonly routeKey: string; readonly policyKey: string },
): Promise<Opened> {
  const threadId = opened.thread.id;
  const problem = await checkThread(daemon, opened, policy);
  if (problem !== null) {
    await releaseThread(daemon, threadId);
    return refused({ kind: 'access-not-supported', reason: problem });
  }
  const model = opened.model === undefined || opened.model === null || opened.model === '' ? null : opened.model;
  if (entry.keep) daemon.loaded.set(threadId, { routeKey: entry.routeKey, policyKey: entry.policyKey, model });
  return { kind: 'opened', threadId, isNew: entry.isNew, model };
}

type Loaded = 'loaded' | 'unloaded' | 'unknown';

/** Unloads `threadId` and waits until `thread/loaded/list` no longer lists it. */
async function unload(daemon: CodexDaemon, threadId: string): Promise<'unloaded' | 'stuck' | 'unknown'> {
  const first = await isLoaded(daemon, threadId);
  if (first !== 'loaded') return first;
  await daemon.call('thread/unsubscribe', { threadId }, ThreadUnsubscribed, LIST_MS);
  const deadline = performance.now() + UNLOAD_MS;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, UNLOAD_POLL_MS));
    const now = await isLoaded(daemon, threadId);
    if (now !== 'loaded') return now;
  }
  return 'stuck';
}

/** Whether the daemon lists `threadId` as loaded, reading every page; `unknown` when it cannot say. */
async function isLoaded(daemon: CodexDaemon, threadId: string): Promise<Loaded> {
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const listed: Call<z.infer<typeof ThreadLoadedListResponse>> = await daemon.call('thread/loaded/list', { limit: PAGE_SIZE, cursor }, ThreadLoadedListResponse, LIST_MS);
    if (listed.kind !== 'ok') return 'unknown';
    if (listed.value.data.includes(threadId)) return 'loaded';
    cursor = listed.value.nextCursor ?? null;
    if (cursor === null) return 'unloaded';
  }
  return 'unknown';
}

function refused(error: ProviderError): Opened {
  return { kind: 'refused', error };
}

function other(what: string, call: { readonly kind: 'error'; readonly message: string } | { readonly kind: 'unanswered'; readonly reason: string }): ProviderError {
  return { kind: 'other', message: call.kind === 'error' ? `Codex could not ${what}: ${call.message}` : call.reason };
}
