import type { ChatCore } from './turn.ts';

/**
 * Who a turn answers: the server owner (this desktop, a paired device or a co-owner), a scoped member, or
 * another agent (a background message or a sub-agent's prompt). Input whose author this host run did not
 * see (a message queued before a restart) counts as a member's, so it never gets more than a member would.
 */
export type TurnInitiator = 'owner' | 'member' | 'agent';

/** The less trusted of two initiators: a turn that answers both acts with only what both may have. */
export function lesser(a: TurnInitiator, b: TurnInitiator): TurnInitiator {
  return a === 'owner' ? b : a;
}

/** Who started the running turn a tool grant belongs to; undefined once that turn has ended. */
export function startedBy(core: ChatCore, grant: { readonly turnId: string; readonly threadId: string }): TurnInitiator | undefined {
  if (core.active.get(grant.threadId)?.generationId !== grant.turnId) return undefined;
  return core.initiators.get(grant.threadId);
}
