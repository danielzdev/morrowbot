import type { Agent, AssistantMessage, BoundProvider, ProviderBinding, SubagentRun, SubagentStatus } from '@morrowbot/contracts';
import type { AdmitResult } from './admission.ts';
import type { SubagentRecord } from './ports.ts';
import { laneOf, localSettlement, queueNote, settle, type ChatCore, type StoredReply, type Turn } from './turn.ts';

/** The binding a thread's turns run with: a sub-agent's own, or its agent's. */
export function bindingOf(core: ChatCore, agent: Agent, threadId: string): ProviderBinding {
  return core.options.store.subagents.get(threadId)?.binding ?? agent.provider;
}

/** A running turn that may start sub-agents now, as they inherit from it. */
export interface ParentTurn {
  readonly threadId: string;
  readonly agentId: string;
  readonly binding: BoundProvider;
  /** The turn is itself a sub-agent's. */
  readonly isSubagent: boolean;
}

/** The turn `generationId` while it is admitted and not stopping; undefined once it settles or is being stopped. */
export function parentTurn(core: ChatCore, generationId: string): ParentTurn | undefined {
  const turn = [...core.active.values()].find((each) => each.generationId === generationId);
  if (turn === undefined || turn.state === 'settled' || turn.stopRequested) return undefined;
  return { threadId: turn.threadId, agentId: turn.agentId, binding: turn.binding, isSubagent: turn.parent !== null };
}

/** The sub-agent turns `generationId` started that are still running or cleaning up. */
function childrenOf(core: ChatCore, generationId: string): Turn[] {
  return [...core.active.values()].filter((turn) => turn.parent?.generationId === generationId);
}

/**
 * Stops a turn the way its state allows, and its sub-agents with it. Resolves once cleanup is over for all of
 * them (see `Turn.quiet`), with the turn's reply.
 */
export async function stopTurn(core: ChatCore, turn: Turn): Promise<StoredReply> {
  const children = stopChildren(core, turn);
  switch (turn.state) {
    case 'queued': {
      const lane = laneOf(core, turn);
      lane.queue.splice(lane.queue.indexOf(turn), 1);
      settle(core, turn, localSettlement({ kind: 'cancelled' }));
      break;
    }
    case 'dispatching':
      turn.stopRequested = true;
      break;
    case 'running':
      turn.stopRequested = true;
      core.options.tools.close(turn.generationId);
      core.options.plugins.cancelTurn(turn.pluginId, turn.generationId);
      break;
    case 'settled':
      break;
  }
  const reply = await turn.settled.promise;
  await turn.quiet.promise;
  await children;
  return reply;
}

export async function stopChildren(core: ChatCore, turn: Turn): Promise<void> {
  await Promise.all(childrenOf(core, turn.generationId).map((child) => stopTurn(core, child)));
}

/** A sub-agent as its parent chat shows it: its prompt and binding, and where its turn is (or how it ended). */
export function subagentView(core: ChatCore, record: SubagentRecord): SubagentRun {
  const messages = core.options.store.messages.listByThread(record.threadId);
  return {
    id: record.threadId,
    parentThreadId: record.parentThreadId,
    parentGenerationId: record.parentGenerationId,
    role: record.role,
    binding: record.binding,
    prompt: messages.find((message) => message.kind === 'user')?.text ?? '',
    status: statusOf(core, record, messages.findLast((message) => message.kind === 'assistant')),
    createdAt: record.createdAt,
  };
}

function statusOf(core: ChatCore, record: SubagentRecord, reply: AssistantMessage | undefined): SubagentStatus {
  const turn = core.active.get(record.threadId);
  if (turn !== undefined && turn.state !== 'settled') {
    return turn.state === 'queued' ? { kind: 'queued', queueNote: queueNote(laneOf(core, turn)) } : { kind: 'running' };
  }
  if (reply === undefined) return { kind: 'queued', queueNote: 'Starting' };
  return { kind: 'finished', outcome: reply.outcome, reply: reply.text, finishedAt: reply.createdAt };
}

/** The sub-agents a chat's turns started, oldest first. */
export function subagentsOf(core: ChatCore, parentThreadId: string): SubagentRun[] {
  return core.options.store.subagents.listByParent(parentThreadId).map((record) => subagentView(core, record));
}

/** Tells a sub-agent's parent chat how the sub-agent is doing now. */
export function publishSubagent(core: ChatCore, turn: Turn): void {
  if (turn.parent === null) return;
  const record = core.options.store.subagents.get(turn.threadId);
  if (record === undefined) return;
  core.events.publish({ kind: 'subagent.changed', threadId: turn.parent.threadId, generationId: turn.parent.generationId, run: subagentView(core, record) });
}

/** Why a sub-agent's turn did not start, in words for the turn that asked. */
export function subagentRefusal(result: AdmitResult): string {
  switch (result.kind) {
    case 'started':
      return 'The sub-agent chat is gone.';
    case 'thread_not_found':
      return 'The chat or its agent is gone.';
    case 'busy':
      return 'The sub-agent is already running.';
    case 'no_provider':
    case 'not_continuable':
      return result.reason;
    case 'provider_unavailable':
      return `The provider is not available right now (${result.reason}).`;
    case 'binding_changed':
      return 'The provider changed while the sub-agent was starting. Try again.';
    case 'session_choice_required':
      return `The provider session needs a choice (${result.reason}).`;
    case 'attachments_missing':
      return 'A sub-agent takes no files.';
  }
}
