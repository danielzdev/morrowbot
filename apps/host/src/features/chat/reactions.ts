import {
  effectiveEmojiReplies,
  type AgentEmojiReplies,
  type AssistantMessage,
  type MessageReaction,
  type SetReactionRequest,
} from '@morrowbot/contracts';
import type { AdmitResult } from './admission.ts';
import type { TurnInitiator } from './initiator.ts';
import type { ChatCore, Turn } from './turn.ts';

export type SetReactionAnswer =
  | { readonly kind: 'set'; readonly reactions: MessageReaction[] }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'conflict'; readonly reason: string };

/** A reaction of the user's that the agent has not read yet: it gets a turn of its own once the chat is idle. */
export interface ReactionNote {
  readonly messageId: string;
  readonly emoji: string;
  readonly by: TurnInitiator;
}

/** Who a tool call acts as: a running turn of `agentId` in `threadId`. */
export interface TurnGrant {
  readonly turnId: string;
  readonly agentId: string;
  readonly threadId: string;
}

export type ReplyToolAnswer = { readonly kind: 'done'; readonly value: object } | { readonly kind: 'refused'; readonly reason: string };

/** The most of the reacted reply the agent reads again. */
const MAX_QUOTE = 4_000;

/** Puts the user's `emoji` on, or takes it off, one of the agent's replies; a new one is noted for the agent. */
export function setUserReaction(core: ChatCore, threadId: string, request: SetReactionRequest, by: TurnInitiator): SetReactionAnswer {
  const { store } = core.options;
  if (core.closed || core.deletingThreads.has(threadId)) return { kind: 'not_found' };
  const message = store.messages.get(request.messageId);
  if (message?.threadId !== threadId) return { kind: 'not_found' };
  if (message.kind !== 'assistant') return { kind: 'conflict', reason: 'You can react to the agent’s replies only.' };
  const { emoji } = request;
  const changed = request.reacted
    ? store.reactions.add({ messageId: message.id, actor: 'user', emoji, createdAt: core.options.now() })
    : store.reactions.remove(message.id, 'user', emoji);
  const reactions = store.reactions.listByMessage(message.id);
  if (!changed) return { kind: 'set', reactions };
  publish(core, threadId, message.id, reactions);
  const others = (core.reactionNotes.get(threadId) ?? []).filter((note) => note.messageId !== message.id || note.emoji !== emoji);
  core.reactionNotes.set(threadId, request.reacted ? [...others, { messageId: message.id, emoji, by }] : others);
  if (request.reacted) core.readNext(threadId);
  return { kind: 'set', reactions };
}

/** `react_to_message`: the turn's agent reacts to the user's message it answers (the steered one, after a steer). */
export function agentReact(core: ChatCore, grant: TurnGrant, emoji: string): ReplyToolAnswer {
  const turn = runningTurn(core, grant);
  if (turn === undefined) return { kind: 'refused', reason: 'This turn has ended.' };
  const { source } = turn;
  switch (source.kind) {
    case 'reaction':
      return { kind: 'refused', reason: 'This turn answers the user’s reaction, not a message: there is nothing to react to.' };
    case 'agent-message':
      return { kind: 'refused', reason: 'This turn reads a message from another agent; the user has no message here to react to.' };
    case 'chat':
      break;
  }
  const { store } = core.options;
  const latest = store.messages.listByThread(turn.threadId).findLast(({ kind }) => kind === 'user');
  const messageId = latest?.id ?? source.message.id;
  if (store.reactions.add({ messageId, actor: 'agent', emoji, createdAt: core.options.now() })) {
    publish(core, turn.threadId, messageId, store.reactions.listByMessage(messageId));
  }
  return { kind: 'done', value: { reacted: { messageId, emoji } } };
}

/** `stay_quiet`: the turn ends with no message in the chat, if the agent may answer that way. */
export function stayQuiet(core: ChatCore, grant: TurnGrant): ReplyToolAnswer {
  const turn = runningTurn(core, grant);
  if (turn === undefined) return { kind: 'refused', reason: 'This turn has ended.' };
  if (turn.source.kind === 'agent-message') {
    return { kind: 'refused', reason: 'This background turn is silent already: the user sees nothing unless you tell them.' };
  }
  if (emojiReplies(core, turn.agentId) === 'off') {
    return { kind: 'refused', reason: 'The user turned emoji-only and silent replies off for you: answer with a text reply.' };
  }
  if (core.options.store.replyAttachments.listOpen(turn.generationId).length > 0) {
    return { kind: 'refused', reason: 'You attached files to this reply, so it needs a message: answer with a short text reply.' };
  }
  turn.silent = true;
  return { kind: 'done', value: { quiet: true, note: 'This turn ends with no message to the user. Write nothing more.' } };
}

/** Why `attach_files` cannot add to this turn's reply, or undefined when it can. */
export function attachRefusal(core: ChatCore, grant: TurnGrant): string | undefined {
  const turn = runningTurn(core, grant);
  if (turn === undefined) return 'This turn has ended.';
  if (turn.source.kind === 'agent-message') return 'This background turn has no reply in the chat to attach files to.';
  if (turn.silent) return 'This turn ends with no message (stay_quiet), so it cannot carry files.';
  return undefined;
}

/** Whether the agent may answer with only an emoji, or nothing: Settings › Chat, then the agent's own setting. */
export function emojiReplies(core: ChatCore, agentId: string): AgentEmojiReplies {
  const agent = core.options.agents.get(agentId);
  return effectiveEmojiReplies(core.options.store.settings.get().emojiReplies, agent?.emojiReplies ?? 'off');
}

/** What the agent reads in the turn a reaction of the user's starts. */
export function reactionPrompt(message: AssistantMessage, emoji: string, allowed: AgentEmojiReplies): string {
  const quote = message.text.length > MAX_QUOTE ? `${message.text.slice(0, MAX_QUOTE)}…` : message.text;
  const ending =
    allowed === 'allowed'
      ? 'When it needs no answer, call the stay_quiet tool and end your turn without writing anything: the user then gets no new message.'
      : 'The user turned silent replies off for you, so answer with a short text reply.';
  return [
    `The user reacted ${emoji} to one of your earlier replies in this chat, quoted below. This is a reaction, not a new message.`,
    'When that reply asked for approval, a go-ahead or a choice, take the reaction as the user’s answer and carry on with the work.',
    ending,
    '',
    '<your-reply>',
    quote,
    '</your-reply>',
  ].join('\n');
}

/**
 * Whether a reaction's turn started, or never can (its chat or reply is gone): either way the note is done.
 * Otherwise the agent reads it at the chat's next idle moment, once its provider is back.
 */
export function readOrGone(result: AdmitResult): boolean {
  switch (result.kind) {
    case 'started':
    case 'thread_not_found':
    case 'not_continuable':
    case 'attachments_missing':
      return true;
    case 'busy':
    case 'no_provider':
    case 'provider_unavailable':
    case 'binding_changed':
    case 'session_choice_required':
      return false;
  }
}

/** A Continue of the failed reaction turn on `reply`: it reads the user's newest reaction there again. */
export function reactionAgain(core: ChatCore, agentId: string, reply: AssistantMessage): { readonly emoji: string; readonly prompt: string } | undefined {
  const emoji = core.options.store.reactions.listByMessage(reply.id).findLast(({ actor }) => actor === 'user')?.emoji;
  return emoji === undefined ? undefined : { emoji, prompt: reactionPrompt(reply, emoji, emojiReplies(core, agentId)) };
}

/** The thread's next reaction to tell the agent about, once it is admitted (see `chat-service.ts`). */
export function nextNote(core: ChatCore, threadId: string): ReactionNote | undefined {
  return core.reactionNotes.get(threadId)?.[0];
}

export function dropNote(core: ChatCore, threadId: string, note: ReactionNote): void {
  const rest = (core.reactionNotes.get(threadId) ?? []).filter((each) => each !== note);
  if (rest.length === 0) core.reactionNotes.delete(threadId);
  else core.reactionNotes.set(threadId, rest);
}

/** The turn `grant` stands for, while it runs. */
export function runningTurn(core: ChatCore, grant: TurnGrant): Turn | undefined {
  const turn = core.active.get(grant.threadId);
  if (turn?.generationId !== grant.turnId || turn.agentId !== grant.agentId || turn.state === 'settled') return undefined;
  return turn;
}

function publish(core: ChatCore, threadId: string, messageId: string, reactions: MessageReaction[]): void {
  core.events.publish({ kind: 'reactions.changed', threadId, messageId, reactions });
}
