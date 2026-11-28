import { realpath } from 'node:fs/promises';
import type { AgentMessage, Message, ProviderUnavailableReason, SessionChoice, SessionChoiceReason, TurnMode, UserMessage } from '@morrowbot/contracts';
import { decideBackgroundSession, decideSession, profileAllowed, type SessionDecision } from './admission-rules.ts';
import { bindingOf } from './children.ts';
import { instructionsHash } from './seed.ts';
import { laneKey, laneOf, pump, type BoundProvider, type ChatCore, type Turn, type TurnSource } from './turn.ts';

export type AdmitResult =
  | { readonly kind: 'started'; readonly generationId: string; readonly userMessage: UserMessage | null }
  | { readonly kind: 'thread_not_found' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'no_provider'; readonly reason: string }
  | { readonly kind: 'provider_unavailable'; readonly reason: ProviderUnavailableReason }
  | { readonly kind: 'binding_changed' }
  | { readonly kind: 'session_choice_required'; readonly reason: SessionChoiceReason }
  | { readonly kind: 'not_continuable'; readonly reason: string }
  /** An attachment the send names is not an unsent upload of this thread. */
  | { readonly kind: 'attachments_missing' };

/** A user's send or Continue, or another agent's message read in the background (with the prompt it is read with). */
export type AdmitInput =
  | { readonly kind: 'send'; readonly text: string; readonly attachmentIds: readonly string[]; readonly mode: TurnMode }
  | { readonly kind: 'continue'; readonly failedMessageId: string }
  /** A queued message, delivered as the user message with its own id; `prompt` is what the provider reads. */
  | { readonly kind: 'queued'; readonly id: string; readonly text: string; readonly prompt: string }
  | { readonly kind: 'agent-message'; readonly message: AgentMessage; readonly prompt: string }
  /** A sub-agent's one prompt, run in its own chat while the turn that started it runs. */
  | { readonly kind: 'subagent'; readonly text: string };

type Ready = {
  readonly binding: BoundProvider;
  readonly bindingJson: string;
  readonly workspaceDir: string;
};

/**
 * Admits a send, a Continue or a background turn. Preflight (provider-info, route-info, AGENTS.md) runs first; then one
 * synchronous step re-checks everything preflight relied on and, in one transaction, writes the user
 * message (send only), the generation and the Continue receipt. Anything refused writes nothing.
 */
export async function admit(core: ChatCore, threadId: string, input: AdmitInput, choice: SessionChoice): Promise<AdmitResult> {
  const { store, plugins, agents } = core.options;
  const receipt = input.kind === 'continue' ? store.generations.continuation(threadId, input.failedMessageId) : undefined;
  if (receipt !== undefined) return { kind: 'started', generationId: receipt, userMessage: null };
  const first = check(core, threadId, input);
  if (first.kind !== 'ready') return first;
  const { binding } = first.ready;
  const pluginId = binding.pluginId;
  if (core.rechecking.has(pluginId)) return { kind: 'provider_unavailable', reason: 'rechecking' };
  const revision = plugins.revision(pluginId);
  const info = await plugins.info(pluginId, false);
  if (info.kind === 'superseded') return { kind: 'binding_changed' };
  if (core.rechecking.has(pluginId)) return { kind: 'provider_unavailable', reason: 'rechecking' };
  if (info.kind === 'unavailable') {
    return info.reason === 'daemon-blocked'
      ? { kind: 'provider_unavailable', reason: 'daemon-blocked' }
      : { kind: 'no_provider', reason: `Provider plugin ${pluginId} is not available: ${info.reason}` };
  }
  const mode = modeOf(input);
  const refused = profileAllowed(info.info, binding, mode);
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
    const moved = plugins.revision(pluginId);
    if (moved.worker !== info.worker || moved.daemonRevision !== info.daemonRevision) return { kind: 'binding_changed' };
    switch (route.kind) {
      case 'known':
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
  let instructions = '';
  try {
    if (capabilities.sessions) instructions = (await agents.readInstructions(first.thread.agentId)) ?? '';
  } catch {
    return { kind: 'no_provider', reason: "Could not read the agent's AGENTS.md" };
  }

  // Everything below is synchronous: nothing can change between the re-check and the write.
  const late = input.kind === 'continue' ? store.generations.continuation(threadId, input.failedMessageId) : undefined;
  if (late !== undefined) return { kind: 'started', generationId: late, userMessage: null };
  const second = check(core, threadId, input);
  if (second.kind !== 'ready') return second;
  const now = plugins.revision(pluginId);
  if (
    second.ready.bindingJson !== first.ready.bindingJson ||
    second.ready.workspaceDir !== first.ready.workspaceDir ||
    now.configRevision !== revision.configRevision ||
    now.worker !== info.worker ||
    now.daemonRevision !== info.daemonRevision
  ) {
    return { kind: 'binding_changed' };
  }
  if (core.rechecking.has(pluginId)) return { kind: 'provider_unavailable', reason: 'rechecking' };
  if (second.parent !== null && !parentRunning(core, second.parent)) return { kind: 'not_continuable', reason: 'The turn that started this sub-agent has ended.' };
  const messages = store.messages.listByThread(threadId);
  const source = sourceOf(core, messages, input);
  if (source.kind === 'refused') return { kind: 'not_continuable', reason: source.reason };
  const attachments = source.kind === 'new' ? store.attachments.pending(threadId, source.attachmentIds) : [];
  if (attachments === undefined) return { kind: 'attachments_missing' };
  const history = source.kind === 'existing' ? messages.slice(0, messages.indexOf(source.message)) : messages;
  const key = { pluginId, accountKey, routeKey, cwd, threadId };
  const row = capabilities.sessions && accountKey !== '' ? store.sessions.find(key) : undefined;
  const sessionInputs = {
    sessions: capabilities.sessions,
    accountKey,
    row,
    systemHash: instructionsHash(instructions),
    vendorSettings: binding.vendorSettings,
    history,
  };
  const decision: SessionDecision =
    source.kind === 'background' ? { kind: 'plan', plan: decideBackgroundSession(sessionInputs) } : decideSession({ ...sessionInputs, choice });
  if (decision.kind === 'choice-required') return { kind: 'session_choice_required', reason: decision.reason };
  const { plan } = decision;
  const at = core.options.now();
  const generationId = core.options.newId();
  const turnSource = sourceFor(source, (text, id = core.options.newId()) => ({ kind: 'user', id, threadId, text, createdAt: at, attachments }));
  const userMessage = (source.kind === 'new' || source.kind === 'queued') && turnSource.kind === 'chat' ? turnSource.message : null;
  store.transaction(() => {
    if (userMessage !== null) {
      store.messages.insert(userMessage);
      store.threads.touch(threadId, at);
    }
    if (source.kind === 'queued') store.queued.delete(source.id);
    store.generations.insert({
      id: generationId,
      threadId,
      pluginId,
      accountKey,
      inputMessageId: turnSource.message.id,
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
    mode,
    binding,
    bindingJson: second.ready.bindingJson,
    workspaceDir: second.ready.workspaceDir,
    configRevision: revision.configRevision,
    worker: info.worker,
    daemonRevision: info.daemonRevision,
    maxSeedBytes: capabilities.maxSeedBytes,
    plan,
    source: turnSource,
    parent: second.parent,
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
    steer: null,
    approvals: new Map(),
    settled: Promise.withResolvers(),
    released: Promise.withResolvers(),
    quiet: Promise.withResolvers(),
  };
  core.active.set(threadId, turn);
  switch (turnSource.kind) {
    case 'chat':
      core.events.publish({ kind: 'generation.started', threadId, generationId, userMessage, state: 'queued' });
      break;
    case 'agent-message':
      core.events.publish({ kind: 'generation.background-started', threadId, generationId, agentMessageId: turnSource.message.id, state: 'queued' });
      break;
  }
  core.subagentChanged(turn);
  const lane = laneOf(core, turn);
  lane.queue.push(turn);
  pump(core, lane);
  return { kind: 'started', generationId, userMessage };
}

type Parent = Turn['parent'];

type Checked =
  | { readonly kind: 'ready'; readonly thread: { readonly id: string; readonly agentId: string }; readonly ready: Ready; readonly parent: Parent }
  | Extract<AdmitResult, { kind: 'thread_not_found' | 'busy' | 'no_provider' }>;

/** `background` for a routine's send and a sub-agent: neither can wait on the user's approval. */
function modeOf(input: AdmitInput): TurnMode {
  switch (input.kind) {
    case 'send':
      return input.mode;
    case 'subagent':
      return 'background';
    case 'continue':
    case 'queued':
    case 'agent-message':
      return 'interactive';
  }
}

/** The turn that started a sub-agent is still running and not being stopped. */
function parentRunning(core: ChatCore, parent: NonNullable<Parent>): boolean {
  const turn = core.active.get(parent.threadId);
  return turn?.generationId === parent.generationId && turn.state !== 'settled' && !turn.stopRequested;
}

/**
 * The thread exists, nothing is deleting it, it is idle and not held by a process group, and it has a binding.
 * A sub-agent's chat takes only its one sub-agent prompt, and no other chat takes one.
 */
function check(core: ChatCore, threadId: string, input: AdmitInput): Checked {
  const { store, agents, plugins } = core.options;
  if (core.closed || core.deletingThreads.has(threadId)) return { kind: 'thread_not_found' };
  const thread = store.threads.get(threadId);
  if (thread === undefined || core.deletingAgents.has(thread.agentId)) return { kind: 'thread_not_found' };
  const record = store.subagents.get(threadId);
  if ((record !== undefined) !== (input.kind === 'subagent')) return { kind: 'thread_not_found' };
  if (record !== undefined && core.deletingThreads.has(record.parentThreadId)) return { kind: 'thread_not_found' };
  if (core.active.has(threadId) || store.heldThreads().has(threadId)) return { kind: 'busy' };
  const agent = agents.get(thread.agentId);
  if (agent === undefined) return { kind: 'thread_not_found' };
  const binding = bindingOf(core, agent, threadId);
  const parent = record === undefined ? null : { threadId: record.parentThreadId, generationId: record.parentGenerationId };
  switch (binding.kind) {
    case 'unbound':
      return { kind: 'no_provider', reason: 'This agent has no provider. Choose a provider and model first.' };
    case 'bound':
      if (!plugins.isProvider(binding.pluginId)) {
        return { kind: 'no_provider', reason: `Provider plugin ${binding.pluginId} is not available.` };
      }
      return { kind: 'ready', thread, parent, ready: { binding, bindingJson: JSON.stringify(binding), workspaceDir: agent.workspace.dir } };
  }
}

type Source =
  | { readonly kind: 'new'; readonly text: string; readonly attachmentIds: readonly string[] }
  | { readonly kind: 'queued'; readonly id: string; readonly text: string; readonly prompt: string }
  | { readonly kind: 'existing'; readonly message: UserMessage }
  | { readonly kind: 'background'; readonly message: AgentMessage; readonly prompt: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** What the turn answers: a send's or queued message's new message (made by `fresh`), a Continue's saved one, or the agent message. */
function sourceFor(source: Exclude<Source, { kind: 'refused' }>, fresh: (text: string, id?: string) => UserMessage): TurnSource {
  switch (source.kind) {
    case 'new':
      return { kind: 'chat', message: fresh(source.text), prompt: source.text };
    case 'queued':
      return { kind: 'chat', message: fresh(source.text, source.id), prompt: source.prompt };
    case 'existing':
      return { kind: 'chat', message: source.message, prompt: source.message.text };
    case 'background':
      return { kind: 'agent-message', message: source.message, prompt: source.prompt };
  }
}

/**
 * A send's or queued message's new text, the saved input of the failed or interrupted latest turn being
 * continued, or an agent message no turn has read yet.
 */
function sourceOf(core: ChatCore, messages: readonly Message[], input: AdmitInput): Source {
  switch (input.kind) {
    case 'send':
      return { kind: 'new', text: input.text, attachmentIds: input.attachmentIds };
    case 'subagent':
      return { kind: 'new', text: input.text, attachmentIds: [] };
    case 'queued':
      return input;
    case 'agent-message':
      return core.options.store.generations.hasInput(input.message.id)
        ? { kind: 'refused', reason: 'This message was already read.' }
        : { kind: 'background', message: input.message, prompt: input.prompt };
    case 'continue':
      break;
  }
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
