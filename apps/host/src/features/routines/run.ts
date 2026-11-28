import {
  QUIET_MARKER,
  type AssistantMessage,
  type ProviderError,
  type RoutineRun,
  type RoutineTrigger,
  type RunRoutineRequest,
  type Wait,
} from '@morrowbot/contracts';
import type { ChatAdmit, FinishedResult, RoutineChat, RoutineRecord, RoutineStore } from './ports.ts';

export interface RunInput {
  readonly trigger: RoutineTrigger;
  /** Absent when the wake call sent none. */
  readonly payload: { readonly kind: 'none' } | { readonly kind: 'json'; readonly value: Exclude<RunRoutineRequest['payload'], undefined> };
  readonly wait: Wait | null;
}

export interface RunContext {
  readonly store: RoutineStore;
  readonly chat: RoutineChat;
  readonly newId: () => string;
  readonly now: () => string;
  readonly report: (error: unknown) => void;
}

/** What the agent is sent: the instruction, then what the wake call brought, then the stay-quiet rule. */
export function promptFor(routine: RoutineRecord, input: RunInput): string {
  const parts = [routine.instruction];
  if (input.wait !== null) parts.push(input.wait.note === '' ? 'The job this routine was waiting on has reported back.' : `The job this routine was waiting on has reported back: ${input.wait.note}`);
  if (input.payload.kind === 'json') parts.push(`It sent this payload:\n\`\`\`json\n${JSON.stringify(input.payload.value, null, 2)}\n\`\`\``);
  if (routine.stayQuietIfNothingNew) parts.push(`If there is nothing new to report, reply with exactly ${QUIET_MARKER} and nothing else.`);
  return parts.join('\n\n');
}

/** Whether a stay-quiet routine's reply says nothing was new. */
export function isQuiet(routine: RoutineRecord, message: AssistantMessage): boolean {
  return routine.stayQuietIfNothingNew && message.outcome.kind === 'completed' && message.text.trim() === QUIET_MARKER;
}

/**
 * Starts one run in a chat of its own, then resolves with the run as admitted (running, or failed when the
 * provider refused it). `settled` resolves once the run's result is stored.
 */
export async function startRun(
  context: RunContext,
  routine: RoutineRecord,
  input: RunInput,
): Promise<{ readonly run: RoutineRun; readonly settled: Promise<void> }> {
  const { store, chat } = context;
  const at = context.now();
  const thread = chat.createThread(routine.agentId, { title: routine.title });
  const base = { id: context.newId(), routineId: routine.id, trigger: input.trigger, waitId: input.wait?.waitId ?? null, at };
  if (thread === undefined) {
    const run: RoutineRun = { ...base, threadId: null, result: { kind: 'failed', finishedAt: at, reason: "The routine's agent no longer exists." } };
    store.runs.insert(run);
    return { run, settled: Promise.resolve() };
  }
  store.runs.insert({ ...base, threadId: thread.id, result: { kind: 'running' } });
  const finished = Promise.withResolvers<AssistantMessage>();
  const stop = chat.subscribe((event) => {
    if (event.kind === 'generation.finished' && event.threadId === thread.id) finished.resolve(event.message);
  });
  let admitted: ChatAdmit;
  try {
    admitted = await chat.send(thread.id, promptFor(routine, input), { kind: 'auto' });
  } catch (error) {
    stop();
    context.report(error);
    admitted = { kind: 'no_provider', reason: 'The host hit an unexpected error.' };
  }
  if (admitted.kind !== 'started') {
    stop();
    const result: FinishedResult = { kind: 'failed', finishedAt: context.now(), reason: refusal(admitted) };
    await chat.deleteThread(thread.id);
    store.runs.finish(base.id, result, null);
    return { run: { ...base, threadId: null, result }, settled: Promise.resolve() };
  }
  const settled = finished.promise.then(async (message) => {
    stop();
    if (isQuiet(routine, message)) {
      await chat.deleteThread(thread.id);
      store.runs.finish(base.id, { kind: 'quiet', finishedAt: context.now() }, null);
      return;
    }
    store.runs.finish(base.id, resultOf(message, context.now()), thread.id);
  });
  return { run: { ...base, threadId: thread.id, result: { kind: 'running' } }, settled };
}

function resultOf(message: AssistantMessage, finishedAt: string): FinishedResult {
  const { outcome } = message;
  switch (outcome.kind) {
    case 'completed':
      return { kind: 'posted', finishedAt };
    case 'cancelled':
      return { kind: 'failed', finishedAt, reason: 'The run was stopped.' };
    case 'interrupted':
      return { kind: 'failed', finishedAt, reason: 'The run was interrupted.' };
    case 'steered':
      return { kind: 'failed', finishedAt, reason: 'The run was stopped for your message.' };
    case 'failed':
      return { kind: 'failed', finishedAt, reason: providerFailure(outcome.error) };
  }
}

function providerFailure(error: ProviderError): string {
  switch (error.kind) {
    case 'other':
      return error.message === '' ? 'The provider failed.' : `The provider failed: ${error.message}`;
    case 'rate-limited':
      return 'The provider is rate limited.';
    case 'signed-out':
      return 'The provider is signed out.';
    case 'background-not-allowed':
      return 'This provider does not allow unattended runs.';
    case 'account-changed':
    case 'not-installed':
    case 'outdated':
    case 'invalid-model':
    case 'transient':
    case 'session-lost':
    case 'route-changed':
    case 'context-too-long':
    case 'access-not-supported':
    case 'binding-changed':
    case 'instructions-changed':
      return `The provider failed (${error.kind}).`;
  }
}

function refusal(admitted: Exclude<ChatAdmit, { kind: 'started' }>): string {
  switch (admitted.kind) {
    case 'thread_not_found':
      return "The run's chat was removed before it started.";
    case 'busy':
      return "The run's chat was busy.";
    case 'no_provider':
    case 'not_continuable':
      return admitted.reason;
    case 'provider_unavailable':
      return `The provider is not available right now (${admitted.reason}).`;
    case 'binding_changed':
      return "The agent's provider settings changed while the run was starting.";
    case 'session_choice_required':
      return `The provider session needs a choice first (${admitted.reason}).`;
    case 'attachments_missing':
      return 'An attachment for the run was missing.';
  }
}
