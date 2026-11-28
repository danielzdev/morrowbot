import type { AssistantMessage, GenerationOutcome, QueuedMessage, QueuedMessageState, UserMessage } from '@morrowbot/contracts';
import { admit, type AdmitInput, type AdmitResult } from './admission.ts';
import { interruptedPrompt, steerPrompt } from './steer-prompt.ts';
import type { ChatCore, Turn } from './turn.ts';

const QUEUED: QueuedMessageState = { kind: 'queued' };
/** A stored message with no state in this host run was queued before a restart. */
const RESTARTED: QueuedMessageState = { kind: 'held', reason: 'Not sent: MorrowBot restarted before the agent saw it.' };

export type QueueAnswer =
  | { readonly kind: 'ok' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict'; readonly reason: string };

export function queueOf(core: ChatCore, threadId: string): QueuedMessage[] {
  return core.options.store.queued.listByThread(threadId).map((record) => ({ ...record, state: core.queueStates.get(record.id) ?? RESTARTED }));
}

function publishQueue(core: ChatCore, threadId: string): void {
  core.events.publish({ kind: 'queue.changed', threadId, queue: queueOf(core, threadId) });
}

function setState(core: ChatCore, threadId: string, ids: readonly string[], state: QueuedMessageState): void {
  for (const id of ids) core.queueStates.set(id, state);
  if (ids.length > 0) publishQueue(core, threadId);
}

/** A send waits in the queue while a turn holds the thread, or while the queue's next message is being sent. */
export function sendsQueue(core: ChatCore, threadId: string): boolean {
  return core.active.has(threadId) || core.draining.has(threadId);
}

export function enqueue(core: ChatCore, threadId: string, text: string): QueuedMessage {
  const record = { id: core.options.newId(), threadId, text, createdAt: core.options.now() };
  core.options.store.queued.insert(record);
  core.queueStates.set(record.id, QUEUED);
  publishQueue(core, threadId);
  return { ...record, state: QUEUED };
}

const STEERING = 'This message is already on its way to the agent.';

export function cancelQueued(core: ChatCore, threadId: string, id: string): QueueAnswer {
  const item = queueOf(core, threadId).find((entry) => entry.id === id);
  if (item === undefined) return { kind: 'not_found' };
  if (item.state.kind === 'steering' || core.draining.get(threadId) === id) return { kind: 'conflict', reason: STEERING };
  core.options.store.queued.delete(id);
  core.queueStates.delete(id);
  publishQueue(core, threadId);
  return { kind: 'ok' };
}

/**
 * Steer now: the message goes into the running reply (natively, or by stopping it and running the
 * message next), or, when nothing runs, out as the next turn at once.
 */
export function steerQueued(core: ChatCore, threadId: string, id: string): QueueAnswer {
  const queue = queueOf(core, threadId);
  const item = queue.find((entry) => entry.id === id);
  if (item === undefined) return { kind: 'not_found' };
  if (item.state.kind === 'steering' || core.draining.get(threadId) === id) return { kind: 'ok' };
  if (queue.some((entry) => entry.state.kind === 'steering') || core.draining.has(threadId)) {
    return { kind: 'conflict', reason: 'Another message is already on its way to the agent.' };
  }
  const turn = core.active.get(threadId);
  if (turn === undefined) {
    void deliver(core, threadId, item, 'next');
    return { kind: 'ok' };
  }
  switch (turn.state) {
    case 'queued':
    case 'dispatching':
      return { kind: 'conflict', reason: "The reply hasn't started yet. Steer it once it is running." };
    case 'settled':
      return { kind: 'conflict', reason: 'The reply is ending. Send this once it has.' };
    case 'running':
      if (turn.stopRequested) return { kind: 'conflict', reason: 'The reply is ending. Send this once it has.' };
      break;
  }
  turn.steer = { id, via: 'native' };
  setState(core, threadId, [id], { kind: 'steering', via: 'native' });
  core.options.plugins.steerTurn(turn.pluginId, turn.generationId, id, steerPrompt(item.text));
  return { kind: 'ok' };
}

/** The plugin cannot take the steer mid-turn: the reply stops, and the message runs next (see `afterTurn`). */
export function steerRefused(core: ChatCore, turn: Turn, steerId: string): void {
  if (turn.steer?.id !== steerId || turn.steer.via !== 'native') return;
  turn.steer = { id: steerId, via: 'interrupt' };
  setState(core, turn.threadId, [steerId], { kind: 'steering', via: 'interrupt' });
  core.options.plugins.cancelTurn(turn.pluginId, turn.generationId);
}

/**
 * The vendor has the steer: the reply so far is saved (outcome `steered`), then the message, in one
 * transaction, and the turn goes on answering it with fresh text.
 */
export function steerDelivered(core: ChatCore, turn: Turn, steerId: string): void {
  if (turn.steer?.id !== steerId) return;
  const { store, newId, now } = core.options;
  const item = store.queued.listByThread(turn.threadId).find((entry) => entry.id === steerId);
  if (item === undefined) return;
  const at = now();
  const base: AssistantMessage = { kind: 'assistant', id: newId(), threadId: turn.threadId, text: turn.text, outcome: { kind: 'steered' }, createdAt: at };
  const segment: AssistantMessage = turn.seedTruncated ? { ...base, seedTruncated: true } : base;
  const userMessage: UserMessage = { kind: 'user', id: item.id, threadId: turn.threadId, text: item.text, createdAt: at, attachments: [] };
  try {
    store.transaction(() => {
      store.messages.insert(segment);
      store.messages.insert(userMessage);
      store.queued.delete(item.id);
      store.threads.touch(turn.threadId, at);
      store.generations.setInputMessage(turn.generationId, userMessage.id);
      store.generations.flushPartial(turn.generationId, '');
    });
  } catch (error) {
    core.options.report(error);
    return;
  }
  turn.steer = null;
  turn.text = '';
  turn.seedTruncated = false;
  core.queueStates.delete(item.id);
  core.events.publish({ kind: 'generation.steered', threadId: turn.threadId, generationId: turn.generationId, segment, userMessage });
  publishQueue(core, turn.threadId);
}

/**
 * A turn freed its thread. A message steered into it runs next; after a completed reply the oldest
 * queued message does; after any other ending the queue is held, since the user stopped or the
 * reply failed.
 */
export function afterTurn(core: ChatCore, turn: Turn, outcome: GenerationOutcome): void {
  const { threadId } = turn;
  if (core.closed || core.deletingThreads.has(threadId) || core.active.has(threadId)) return;
  const waiting = queueOf(core, threadId).filter((entry) => entry.state.kind !== 'held');
  const steered = turn.steer === null ? undefined : waiting.find((entry) => entry.id === turn.steer?.id);
  if (steered !== undefined && (outcome.kind === 'steered' || outcome.kind === 'completed')) {
    void deliver(core, threadId, steered, outcome.kind === 'steered' ? 'interrupted' : 'next');
    return;
  }
  const next = waiting[0];
  if (next === undefined) return;
  if (outcome.kind === 'completed') {
    void deliver(core, threadId, next, 'next');
    return;
  }
  setState(core, threadId, waiting.map(({ id }) => id), { kind: 'held', reason: heldReason(outcome) });
}

function heldReason(outcome: Exclude<GenerationOutcome, { kind: 'completed' }>): string {
  switch (outcome.kind) {
    case 'cancelled':
      return 'Not sent: you stopped the reply.';
    case 'interrupted':
      return 'Not sent: the reply was interrupted.';
    case 'failed':
      return 'Not sent: the reply failed.';
    case 'steered':
      return 'Not sent.';
  }
}

/** Sends one queued message as the thread's next turn; a refusal holds the whole queue with its reason. */
async function deliver(core: ChatCore, threadId: string, item: QueuedMessage, how: 'next' | 'interrupted'): Promise<void> {
  core.draining.set(threadId, item.id);
  let result: AdmitResult;
  try {
    const input: AdmitInput = { kind: 'queued', id: item.id, text: item.text, prompt: how === 'next' ? item.text : interruptedPrompt(item.text) };
    if (how === 'next') {
      result = await admit(core, threadId, input, { kind: 'auto' });
    } else {
      result = await admit(core, threadId, input, { kind: 'continue-existing' });
      if (result.kind === 'session_choice_required') result = await admit(core, threadId, input, { kind: 'new-seeded' });
    }
  } catch (error) {
    core.options.report(error);
    result = { kind: 'no_provider', reason: 'Something went wrong while sending it.' };
  } finally {
    core.draining.delete(threadId);
  }
  if (result.kind === 'started') {
    core.queueStates.delete(item.id);
    publishQueue(core, threadId);
    return;
  }
  const waiting = queueOf(core, threadId).filter((entry) => entry.state.kind !== 'held');
  setState(core, threadId, waiting.map(({ id }) => id), { kind: 'held', reason: refusalReason(result) });
}

function refusalReason(result: Exclude<AdmitResult, { kind: 'started' }>): string {
  switch (result.kind) {
    case 'thread_not_found':
      return 'Not sent: this chat is gone.';
    case 'busy':
      return 'Not sent: the chat was still busy.';
    case 'no_provider':
    case 'not_continuable':
      return `Not sent: ${result.reason}`;
    case 'provider_unavailable':
      return "Not sent: the provider isn't available right now.";
    case 'binding_changed':
      return "Not sent: the agent's provider settings changed.";
    case 'session_choice_required':
      return "Not sent: the provider's saved session needs your choice. Edit it and send it from the message box.";
    case 'attachments_missing':
      return 'Not sent: an attached file is no longer there.';
  }
}
