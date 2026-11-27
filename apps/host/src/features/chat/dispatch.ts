import { realpath } from 'node:fs/promises';
import type { ProviderInfo, TurnChunk, TurnEnd, TurnRequest, TurnSession, UsageWindow } from '@morrowbot/contracts';
import { profileAllowed } from './admission-rules.ts';
import type { TurnSink } from './ports.ts';
import { instructionsHash, renderSeed, SEEDED_SESSION_BUDGET, statelessBudget, type Seed } from './seed.ts';
import { laneKey, laneOf, localSettlement, settle, type ChatCore, type LiveUsage, type Turn } from './turn.ts';

const FLUSH_MS = 1_000;

/**
 * Sends a turn that got a slot. It reads AGENTS.md once (for `system`, a new session's hash and the
 * resume check), then re-checks everything the admission relied on, applies the session effects and
 * sends `turn` in one synchronous step. A turn stopped, unbound or changed meanwhile sends nothing.
 */
export async function dispatch(core: ChatCore, turn: Turn): Promise<void> {
  const { store, agents, plugins } = core.options;
  turn.state = 'dispatching';
  const read = await readTurnInputs(core, turn);
  if (turn.stopRequested) {
    settle(core, turn, localSettlement({ kind: 'cancelled' }));
    return;
  }
  if (read.kind === 'unreadable') {
    settle(core, turn, localSettlement({ kind: 'failed', error: { kind: 'other', message: read.message } }));
    return;
  }
  const { instructions } = read;
  const agent = agents.get(turn.agentId);
  const revision = plugins.revision(turn.pluginId);
  const info = plugins.cachedInfo(turn.pluginId);
  const unchanged =
    agent !== undefined &&
    read.cwd === turn.cwd &&
    JSON.stringify(agent.provider) === turn.bindingJson &&
    agent.workspace.dir === turn.workspaceDir &&
    revision.configRevision === turn.configRevision &&
    revision.worker === turn.worker &&
    revision.daemonRevision === turn.daemonRevision &&
    plugins.canStart(turn.pluginId, turn.worker) &&
    info?.worker === turn.worker &&
    profileAllowed(info.info, turn.binding, 'interactive') === undefined;
  if (!unchanged) {
    settle(core, turn, localSettlement({ kind: 'failed', error: { kind: 'binding-changed' } }));
    return;
  }
  if (accountMoved(turn, info.info)) {
    settle(core, turn, localSettlement({ kind: 'failed', error: { kind: 'account-changed' } }));
    accountChanged(core, turn.pluginId, turn.accountKey);
    return;
  }
  const hash = instructionsHash(instructions);
  if (turn.plan.kind === 'resume') {
    const row = store.sessions.get(turn.plan.rowId);
    if (row === undefined || row.systemHash !== hash || row.vendorSettings !== turn.binding.vendorSettings) {
      settle(core, turn, localSettlement({ kind: 'failed', error: { kind: 'instructions-changed' } }));
      return;
    }
  }
  const seed = seedFor(turn);
  turn.seedTruncated = seed.truncated;
  turn.systemHash = hash;
  const session: TurnSession = turn.plan.kind === 'resume' ? { kind: 'resume', ref: turn.plan.ref } : { kind: 'new', seed: seed.text };
  const request: TurnRequest = {
    turnId: turn.generationId,
    cwd: turn.cwd,
    mode: 'interactive',
    access: turn.binding.access,
    vendorSettings: turn.binding.vendorSettings,
    expectedAccountKey: turn.accountKey,
    expectedRouteKey: turn.routeKey,
    selection: turn.binding.selection,
    session,
    system: turn.binding.vendorSettings === 'isolated' ? instructions : null,
    prompt: turn.input.kind === 'chat' ? turn.input.message.text : turn.input.prompt,
  };
  try {
    store.transaction(() => {
      store.generations.markDispatched(turn.generationId, core.options.now());
      if (turn.plan.kind === 'resume') store.sessions.setState(turn.plan.rowId, 'diverged');
      store.sessions.markOthersNeedSeed({
        pluginId: turn.pluginId,
        accountKey: turn.accountKey,
        routeKey: turn.routeKey,
        cwd: turn.cwd,
        threadId: turn.threadId,
      });
      plugins.linkDaemon(turn.pluginId, turn.worker, turn.generationId);
    });
  } catch (error) {
    core.options.report(error);
    settle(core, turn, localSettlement({ kind: 'failed', error: { kind: 'other', message: 'Could not save the turn' } }));
    return;
  }
  turn.dispatched = true;
  turn.state = 'running';
  core.events.publish({ kind: 'generation.status', threadId: turn.threadId, generationId: turn.generationId, state: 'running', queueNote: null, detail: null });
  if (plugins.startTurn(turn.pluginId, turn.worker, request, sinkFor(core, turn)) === 'binding-changed') {
    settle(core, turn, { ...localSettlement({ kind: 'failed', error: { kind: 'binding-changed' } }), sessionTouched: false });
  }
}

type TurnInputs =
  | { readonly kind: 'read'; readonly instructions: string; readonly cwd: string }
  | { readonly kind: 'unreadable'; readonly message: string };

/** AGENTS.md as it is now, and the workspace's canonical path (a moved symlink no longer matches the admitted cwd). */
async function readTurnInputs(core: ChatCore, turn: Turn): Promise<TurnInputs> {
  try {
    const [instructions, cwd] = await Promise.all([core.options.agents.readInstructions(turn.agentId), realpath(turn.workspaceDir)]);
    return { kind: 'read', instructions: instructions ?? '', cwd };
  } catch (error) {
    core.options.report(error);
    return { kind: 'unreadable', message: "Could not read the agent's workspace or AGENTS.md" };
  }
}

/** A stateless turn whose account the plugin now reports differently: it would be refused, so it is not sent. */
function accountMoved(turn: Turn, info: ProviderInfo): boolean {
  if (turn.plan.kind !== 'stateless' || turn.accountKey === '') return false;
  if (info.kind !== 'ready' && info.kind !== 'ready-models-later') return false;
  return !info.capabilities.sessions && info.accountKey !== '' && info.accountKey !== turn.accountKey;
}

function seedFor(turn: Turn): Seed {
  switch (turn.plan.kind) {
    case 'stateless':
      return renderSeed(turn.history, statelessBudget(turn.maxSeedBytes));
    case 'fresh':
      return turn.plan.seeded ? renderSeed(turn.history, SEEDED_SESSION_BUDGET) : { text: null, truncated: false };
    case 'resume':
      return { text: null, truncated: false };
  }
}

function sinkFor(core: ChatCore, turn: Turn): TurnSink {
  return {
    onChunk: (chunk) => {
      if (turn.state !== 'running' || turn.fenced) return;
      onChunk(core, turn, chunk);
    },
    onEnd: (end) => {
      onEnd(core, turn, end);
    },
    onLost: () => {
      settle(core, turn, { ...localSettlement({ kind: 'interrupted' }), sessionTouched: true });
    },
  };
}

function onChunk(core: ChatCore, turn: Turn, chunk: TurnChunk): void {
  const ref = { threadId: turn.threadId, generationId: turn.generationId };
  const { store } = core.options;
  switch (chunk.kind) {
    case 'text':
      if (chunk.text === '') return;
      turn.text += chunk.text;
      core.events.publish({ kind: 'generation.delta', ...ref, text: chunk.text });
      turn.flushTimer ??= setTimeout(() => {
        turn.flushTimer = undefined;
        if (turn.state === 'running') store.generations.flushPartial(turn.generationId, turn.text);
      }, FLUSH_MS);
      return;
    case 'status':
      core.events.publish({ kind: 'generation.status', ...ref, state: 'running', queueNote: null, detail: chunk.text });
      return;
    case 'tool-start':
      core.events.publish({ kind: 'generation.tool-start', ...ref, toolUseId: chunk.toolUseId, name: chunk.name, input: chunk.input });
      return;
    case 'tool-end':
      core.events.publish({ kind: 'generation.tool-end', ...ref, toolUseId: chunk.toolUseId, outcome: chunk.outcome });
      return;
    case 'session-bound': {
      if (chunk.accountKey === '' || chunk.accountKey !== turn.accountKey || chunk.routeKey !== turn.routeKey) return;
      if (turn.plan.kind === 'stateless' || turn.systemHash === null) return;
      if (turn.plan.kind === 'resume' && chunk.ref === turn.plan.ref) return;
      const key = { pluginId: turn.pluginId, accountKey: chunk.accountKey, routeKey: chunk.routeKey, cwd: turn.cwd, threadId: turn.threadId };
      const systemHash = turn.systemHash;
      store.transaction(() => {
        turn.boundRow = store.sessions.bind(key, chunk.ref, systemHash, turn.binding.vendorSettings);
        store.generations.setAttemptedSessionRow(turn.generationId, turn.boundRow);
      });
      return;
    }
    case 'usage-update':
      if (chunk.accountKey === '') {
        mergeLiveUsage(core, turn, chunk.observedAt, chunk.windows);
      } else if (chunk.accountKey !== turn.accountKey || core.fenced.has(laneKey(turn.pluginId, chunk.accountKey))) {
        return;
      } else {
        store.usage.merge(turn.pluginId, chunk.accountKey, chunk.observedAt, chunk.windows);
      }
      core.events.publishGlobal({ kind: 'usage.updated', pluginId: turn.pluginId, accountKey: chunk.accountKey });
      return;
    case 'approval-request': {
      const approval = { approvalId: chunk.approvalId, summary: chunk.summary, choices: chunk.choices };
      turn.approvals.set(chunk.approvalId, approval);
      core.events.publish({ kind: 'generation.approval-requested', ...ref, approval });
      return;
    }
    case 'approval-expired':
      if (!turn.approvals.delete(chunk.approvalId)) return;
      core.events.publish({ kind: 'generation.approval-resolved', ...ref, approvalId: chunk.approvalId, resolution: { kind: 'expired' } });
      return;
    case 'model-options-changed':
      void core.options.plugins.info(turn.pluginId, true);
      return;
  }
}

function mergeLiveUsage(core: ChatCore, turn: Turn, observedAt: string, windows: readonly UsageWindow[]): void {
  const current = core.liveUsage.get(turn.pluginId);
  const live: LiveUsage = current?.worker === turn.worker ? current : { worker: turn.worker, windows: new Map() };
  core.liveUsage.set(turn.pluginId, live);
  for (const window of windows) {
    const seen = live.windows.get(window.id);
    if (seen === undefined || Date.parse(seen.observedAt) < Date.parse(observedAt)) live.windows.set(window.id, { observedAt, window });
  }
}

function onEnd(core: ChatCore, turn: Turn, end: TurnEnd): void {
  // A fenced turn, or one that ends on another known account, keeps nothing the plugin said but whether it touched the session.
  const otherAccount = turn.accountKey !== '' && end.accountKey !== '' && end.accountKey !== turn.accountKey;
  if (turn.fenced || otherAccount) {
    turn.text = '';
    settle(core, turn, { ...localSettlement({ kind: 'failed', error: { kind: 'account-changed' } }), sessionTouched: end.sessionTouched });
    if (otherAccount && !turn.fenced) accountChanged(core, turn.pluginId, turn.accountKey);
    return;
  }
  settle(core, turn, { outcome: end.outcome, usage: end.usage, actualModel: end.actualModel, finalText: end.finalText, sessionTouched: end.sessionTouched });
  if (end.outcome.kind !== 'failed') return;
  const { kind } = end.outcome.error;
  if (kind === 'account-changed') accountChanged(core, turn.pluginId, turn.accountKey);
  else if (kind === 'route-changed' || kind === 'signed-out' || kind === 'access-not-supported') void core.options.plugins.info(turn.pluginId, true);
}

/**
 * The account behind a plugin changed: refresh its info, fail its queued turns for the old account,
 * stop the running ones (their output is dropped from now on), and drop later usage for the old account.
 */
export function accountChanged(core: ChatCore, pluginId: string, oldKey: string): void {
  if (oldKey === '') return;
  core.fenced.add(laneKey(pluginId, oldKey));
  void core.options.plugins.info(pluginId, true);
  for (const turn of [...core.active.values()]) {
    if (turn.pluginId !== pluginId || turn.accountKey !== oldKey || turn.state === 'settled') continue;
    if (turn.state === 'queued') {
      const lane = laneOf(core, turn);
      lane.queue.splice(lane.queue.indexOf(turn), 1);
      settle(core, turn, localSettlement({ kind: 'failed', error: { kind: 'account-changed' } }));
    } else {
      turn.fenced = true;
      turn.stopRequested = true;
      if (turn.state === 'running') core.options.plugins.cancelTurn(pluginId, turn.generationId);
    }
  }
}
