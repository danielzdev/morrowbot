import type { Agent } from '@morrowbot/contracts';
import type { LiveFacts } from '../features/agents/index.ts';
import type { ThreadActivity } from '../features/chat/index.ts';
import { providerStatus, type ProviderCard } from '../features/providers/index.ts';
import type { ThreadStatus } from '../features/thread/index.ts';
import type { Loadable } from '../shared/store.ts';

type Activity = Readonly<Record<string, ThreadActivity>>;

/** One chat's status for the header pill and the switcher, from what its open session reports. */
export function threadStatusOf(activity: Activity, threadId: string): ThreadStatus {
  const each = activity[threadId];
  if (each === undefined) return 'idle';
  switch (each.activity) {
    case 'needs-approval':
      return 'needs-approval';
    case 'thinking':
    case 'streaming':
      return 'working';
    case 'queued':
      return 'queued';
    case 'idle':
    case 'completed':
      return each.failed ? 'failed' : 'idle';
  }
}

/** Whether the agent's provider can take a turn: null while its status loads, so it is never flagged by mistake. */
function providerReady(cards: Loadable<readonly ProviderCard[]>, agent: Agent): boolean | null {
  if (agent.provider.kind === 'unbound' || cards.kind !== 'loaded') return null;
  const { pluginId } = agent.provider;
  const card = cards.value.find(({ entry }) => entry.manifest.id === pluginId);
  if (card === undefined) return false;
  const summary = providerStatus(card.entry, card.info);
  if (summary.state === 'checking') return null;
  return summary.runnable;
}

/** What the sidebar shows beyond each agent's chat list. */
export function liveFactsOf(cards: Loadable<readonly ProviderCard[]>, activity: Activity, agent: Agent): LiveFacts {
  const mine = Object.entries(activity).filter(([, each]) => each.agentId === agent.id);
  const has = (wanted: ThreadStatus): boolean => mine.some(([threadId]) => threadStatusOf(activity, threadId) === wanted);
  return {
    providerReady: providerReady(cards, agent),
    approvalChats: mine.filter(([threadId]) => threadStatusOf(activity, threadId) === 'needs-approval').map(([threadId]) => threadId),
    failed: has('failed'),
    working: has('working') ? 'running' : has('queued') ? 'queued' : null,
  };
}

