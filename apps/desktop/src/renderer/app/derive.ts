import type { Agent, PluginEntry } from '@morrowbot/contracts';
import type { LiveFacts } from '../features/agents/index.ts';
import type { ThreadActivity } from '../features/chat/index.ts';
import { summarize, type PluginCard } from '../features/plugins/index.ts';
import type { ThreadStatus } from '../features/thread/index.ts';
import { providerNames } from '../shared/binding-ui/provider-names.ts';
import { isRunnable, readinessOf, type ProviderChoice } from '../shared/binding-ui/selection.ts';
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
function providerReady(cards: Loadable<readonly PluginCard[]>, agent: Agent): boolean | null {
  if (agent.provider.kind === 'unbound' || cards.kind !== 'loaded') return null;
  const { pluginId } = agent.provider;
  const choice = providerChoicesOf(cards).find(({ id }) => id === pluginId);
  if (choice === undefined) return false;
  if (readinessOf(choice).kind === 'checking') return null;
  return isRunnable(choice);
}

/** What the sidebar shows beyond each agent's chat list. */
export function liveFactsOf(cards: Loadable<readonly PluginCard[]>, activity: Activity, agent: Agent): LiveFacts {
  const mine = Object.entries(activity).filter(([, each]) => each.agentId === agent.id);
  const has = (wanted: ThreadStatus): boolean => mine.some(([threadId]) => threadStatusOf(activity, threadId) === wanted);
  return {
    providerReady: providerReady(cards, agent),
    approvalChats: mine.filter(([threadId]) => threadStatusOf(activity, threadId) === 'needs-approval').map(([threadId]) => threadId),
    failed: has('failed'),
    working: has('working') ? 'running' : has('queued') ? 'queued' : null,
  };
}

export const entriesOf = (cards: Loadable<readonly PluginCard[]>): readonly PluginEntry[] => (cards.kind === 'loaded' ? cards.value.map(({ entry }) => entry) : []);

/** Every provider as the pickers see it. Info counts only while its process runs; otherwise its own status shows. */
export function providerChoicesOf(cards: Loadable<readonly PluginCard[]>): readonly ProviderChoice[] {
  if (cards.kind !== 'loaded') return [];
  return cards.value
    .filter(({ entry }) => entry.manifest.kind === 'provider')
    .map(({ entry, info }) => {
      const running = entry.status.kind === 'running';
      const down = !entry.enabled ? null : !running ? summarize(entry, info).title : info?.kind === 'failed' ? "Couldn't check provider" : null;
      return {
        id: entry.manifest.id,
        ...providerNames(entry.manifest.id, entry.manifest.name),
        enabled: entry.enabled,
        info: running && info?.kind === 'loaded' ? info.value : undefined,
        down,
      };
    });
}

/** The agent's provider among `choices`; while the list loads, a placeholder that reads "Checking…". */
export function choiceFor(cards: Loadable<readonly PluginCard[]>, choices: readonly ProviderChoice[], pluginId: string): ProviderChoice | undefined {
  const found = choices.find(({ id }) => id === pluginId);
  if (found !== undefined || cards.kind !== 'loading') return found;
  return { id: pluginId, ...providerNames(pluginId, pluginId), enabled: true, info: undefined, down: null };
}
