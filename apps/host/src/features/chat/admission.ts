import { realpath } from 'node:fs/promises';
import type { Message, ProviderUnavailableReason, SessionChoice, SessionChoiceReason, UserMessage } from '@morrowbot/contracts';
import { decideSession, profileAllowed } from './admission-rules.ts';
import { instructionsHash } from './seed.ts';
import { laneKey, laneOf, pump, type BoundProvider, type ChatCore, type Turn } from './turn.ts';

export type AdmitResult =
  | { readonly kind: 'started'; readonly generationId: string; readonly userMessage: UserMessage | null }
  | { readonly kind: 'thread_not_found' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'no_provider'; readonly reason: string }
  | { readonly kind: 'provider_unavailable'; readonly reason: ProviderUnavailableReason }
  | { readonly kind: 'binding_changed' }
  | { readonly kind: 'session_choice_required'; readonly reason: SessionChoiceReason }
  | { readonly kind: 'not_continuable'; readonly reason: string };

export type AdmitInput =
  | { readonly kind: 'send'; readonly text: string }
  | { readonly kind: 'continue'; readonly failedMessageId: string };

type Ready = {
  readonly binding: BoundProvider;
  readonly bindingJson: string;
  readonly workspaceDir: string;
};

/**
 * Admits a send or a Continue. Preflight (provider-info, route-info, AGENTS.md) runs first; then one
 * synchronous step re-checks everything preflight relied on and, in one transaction, writes the user
 * message (send only), the generation and the Continue receipt. Anything refused writes nothing.
 */
export async function admit(core: ChatCore, threadId: string, input: AdmitInput, choice: SessionChoice): Promise<AdmitResult> {
  const { store, plugins, agents } = core.options;
  const receipt = input.kind === 'continue' ? store.generations.continuation(threadId, input.failedMessageId) : undefined;
  if (receipt !== undefined) return { kind: 'started', generationId: receipt, userMessage: null };
  const first = check(core, threadId);
  if (first.kind !== 'ready') return first;
  const { binding } = first.ready;
  const pluginId = binding.pluginId;
  if (core.rechecking.has(pluginId)) return { kind: 'provider_unavailable', reason: 'rechecking' };
  const revision = plugins.revision(pluginId);
  const info = await plugins.info(pluginId, false);
  if (info.kind === 'unavailable') {
    return info.reason === 'daemon-blocked'
      ? { kind: 'provider_unavailable', reason: 'daemon-blocked' }
      : { kind: 'no_provider', reason: `Provider plugin ${pluginId} is not available: ${info.reason}` };
  }
  const refused = profileAllowed(info.info, binding, 'interactive');
  if (refused !== undefined) return { kind: 'no_provider', reason: refused };
  if (info.info.kind !== 'ready' && info.info.kind !== 'ready-models-later') return { kind: 'no_provider', reason: 'not ready' };
  const capabilities = info.info.capabilities;
  let cwd: string;
  try {
    cwd = await realpath(first.ready.workspaceDir);
  } catch {
    return { kind: 'no_provider', reason: `The agent's workspace ${first.ready.workspaceDir} is missing` };
  }
  let accountKey = info.info.accountKey;
  let routeKey = '';
  if (capabilities.sessions) {
    const route = await plugins.routeInfo(pluginId, cwd);
    switch (route.kind) {
      case 'known':
        if (route.worker !== info.worker) return { kind: 'binding_changed' };
        accountKey = route.accountKey;
        routeKey = route.routeKey;
        break;
      case 'timeout':
        return { kind: 'provider_unavailable', reason: 'route-info-timeout' };
      case 'failed':
        return { kind: 'provider_unavailable', reason: 'route-info-failed' };
      case 'daemon-blocked':
        return { kind: 'provider_unavailable', reason: 'daemon-blocked' };
      case 'unavailable':
        return { kind: 'no_provider', reason: route.reason };
    }
  }
  const instructions = capabilities.sessions ? ((await agents.readInstructions(first.thread.agentId)) ?? '') : '';

  // Everything below is synchronous: nothing can change between the re-check and the write.
  const late = input.kind === 'continue' ? store.generations.continuation(threadId, input.failedMessageId) : undefined;
  if (late !== undefined) return { kind: 'started', generationId: late, userMessage: null };
  const second = check(core, threadId);
  if (second.kind !== 'ready') return second;
  const now = plugins.revision(pluginId);
  if (
    second.ready.bindingJson !== first.ready.bindingJson ||
    second.ready.workspaceDir !== first.ready.workspaceDir ||
    now.configRevision !== revision.configRevision ||
    now.worker !== info.worker
  ) {
    return { kind: 'binding_changed' };
  }
  if (core.rechecking.has(pluginId)) return { kind: 'provider_unavailable', reason: 'rechecking' };
  const messages = store.messages.listByThread(threadId);
  const source = sourceOf(core, messages, input);
  if (source.kind === 'refused') return { kind: 'not_continuable', reason: source.reason };
  const history = source.kind === 'existing' ? messages.slice(0, messages.indexOf(source.message)) : messages;
  const key = { pluginId, accountKey, routeKey, cwd, threadId };
  const row = capabilities.sessions && accountKey !== '' ? store.sessions.find(key) : undefined;
  const decision = decideSession({
    sessions: capabilities.sessions,
    accountKey,
    row,
    systemHash: instructionsHash(instructions),
    vendorSettings: binding.vendorSettings,
    history,
    choice,
  });
  if (decision.kind === 'choice-required') return { kind: 'session_choice_required', reason: decision.reason };
  const { plan } = decision;
  const at = core.options.now();
  const generationId = core.options.newId();
  const userMessage: UserMessage =
    source.kind === 'existing' ? source.message : { kind: 'user', id: core.options.newId(), threadId, text: source.text, createdAt: at };
  store.transaction(() => {
    if (source.kind === 'new') {
      store.messages.insert(userMessage);
      store.threads.touch(threadId, at);
    }
    store.generations.insert({
      id: generationId,
      threadId,
      pluginId,
      accountKey,
      inputMessageId: userMessage.id,
      startedAt: at,
      attemptedSessionRow: plan.kind === 'resume' ? plan.rowId : null,
      priorState: plan.kind === 'resume' ? plan.priorState : null,
    });
    if (input.kind === 'continue') store.generations.insertContinuation(threadId, input.failedMessageId, generationId, at);
  });
  core.fenced.delete(laneKey(pluginId, accountKey));
  const turn: Turn = {
    generationId,
    threadId,
    agentId: second.thread.agentId,
    pluginId,
    accountKey,
    routeKey,
    cwd,
    binding,
    bindingJson: second.ready.bindingJson,
    workspaceDir: second.ready.workspaceDir,
    configRevision: revision.configRevision,
    worker: info.worker,
    maxSeedBytes: capabilities.maxSeedBytes,
    plan,
    sourceInput: userMessage,
    history,
    state: 'queued',
    dispatched: false,
    text: '',
    flushTimer: undefined,
    seedTruncated: false,
    systemHash: null,
    boundRow: null,
    fenced: false,
    stopRequested: false,
    approvals: new Map(),
    settled: Promise.withResolvers(),
    released: Promise.withResolvers(),
  };
  core.active.set(threadId, turn);
  core.events.publish({
    kind: 'generation.started',
    threadId,
    generationId,
    userMessage: source.kind === 'new' ? userMessage : null,
    state: 'queued',
  });
  const lane = laneOf(core, turn);
  lane.queue.push(turn);
  pump(core, lane);
  return { kind: 'started', generationId, userMessage: source.kind === 'new' ? userMessage : null };
}

type Checked =
  | { readonly kind: 'ready'; readonly thread: { readonly id: string; readonly agentId: string }; readonly ready: Ready }
  | Extract<AdmitResult, { kind: 'thread_not_found' | 'busy' | 'no_provider' }>;

/** The thread exists, nothing is deleting it, it is idle and not held by a process group, and its agent is bound. */
function check(core: ChatCore, threadId: string): Checked {
  const { store, agents, plugins } = core.options;
  if (core.closed || core.deletingThreads.has(threadId)) return { kind: 'thread_not_found' };
  const thread = store.threads.get(threadId);
  if (thread === undefined || core.deletingAgents.has(thread.agentId)) return { kind: 'thread_not_found' };
  if (core.active.has(threadId) || store.heldThreads().has(threadId)) return { kind: 'busy' };
  const agent = agents.get(thread.agentId);
  if (agent === undefined) return { kind: 'thread_not_found' };
  switch (agent.provider.kind) {
    case 'unbound':
      return { kind: 'no_provider', reason: 'This agent has no provider. Choose a provider and model first.' };
    case 'bound':
      if (!plugins.isProvider(agent.provider.pluginId)) {
        return { kind: 'no_provider', reason: `Provider plugin ${agent.provider.pluginId} is not available.` };
      }
      return {
        kind: 'ready',
        thread,
        ready: { binding: agent.provider, bindingJson: JSON.stringify(agent.provider), workspaceDir: agent.workspace.dir },
      };
  }
}

type Source =
  | { readonly kind: 'new'; readonly text: string }
  | { readonly kind: 'existing'; readonly message: UserMessage }
  | { readonly kind: 'refused'; readonly reason: string };

/** A send's new text, or the saved input of the failed or interrupted latest turn being continued. */
function sourceOf(core: ChatCore, messages: readonly Message[], input: { readonly kind: 'send'; readonly text: string } | { readonly kind: 'continue'; readonly failedMessageId: string }): Source {
  if (input.kind === 'send') return { kind: 'new', text: input.text };
  const latest = messages.at(-1);
  if (latest?.id !== input.failedMessageId) return { kind: 'refused', reason: 'Only the latest message can be continued.' };
  if (latest.kind !== 'assistant' || (latest.outcome.kind !== 'failed' && latest.outcome.kind !== 'interrupted')) {
    return { kind: 'refused', reason: 'Only a failed or interrupted reply can be continued.' };
  }
  const generation = core.options.store.generations.byResultMessage(latest.id);
  const original = generation === undefined ? undefined : messages.find((message) => message.id === generation.inputMessageId);
  if (original?.kind !== 'user') return { kind: 'refused', reason: 'This reply has no saved input to continue from.' };
  return { kind: 'existing', message: original };
}
