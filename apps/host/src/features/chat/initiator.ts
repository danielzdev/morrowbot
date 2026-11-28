import type { GenerationOutcome } from '@morrowbot/contracts';
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

/** Who started the running turn a tool grant belongs to; undefined once that turn has settled. */
export function startedBy(core: ChatCore, grant: { readonly turnId: string; readonly threadId: string }): TurnInitiator | undefined {
  const turn = core.active.get(grant.threadId);
  if (turn?.generationId !== grant.turnId || turn.state === 'settled') return undefined;
  return core.initiators.get(grant.turnId);
}

/** Who started the turn that wrote reply `messageId`; a reply from before this host run counts as a member's. */
export function initiatorOfReply(core: ChatCore, messageId: string): TurnInitiator {
  const generation = core.options.store.generations.byResultMessage(messageId);
  return (generation === undefined ? undefined : core.initiators.get(generation.id)) ?? 'member';
}

/** A settled turn's initiator is kept only while its reply can still be continued (it failed or was interrupted). */
export function forgetSettled(core: ChatCore, generationId: string, outcome: GenerationOutcome): void {
  if (outcome.kind !== 'failed' && outcome.kind !== 'interrupted') core.initiators.delete(generationId);
}

/** Reads the threads' turn and queued message ids now; the returned call forgets them once the threads are deleted. */
export function attributionOf(core: ChatCore, threadIds: readonly string[]): () => void {
  const { store } = core.options;
  const generations = threadIds.flatMap((id) => [...store.generations.idsByThread(id)]);
  const queued = threadIds.flatMap((id) => store.queued.listByThread(id).map((record) => record.id));
  return () => {
    for (const id of generations) core.initiators.delete(id);
    for (const id of queued) {
      core.queueAuthors.delete(id);
      core.queueStates.delete(id);
    }
  };
}
