import { UsageSection, type UsageProvider } from '../features/usage/index.ts';
import { useStore } from '../shared/use-store.ts';
import type { Models } from './models.ts';

/** Settings › Usage wired to the providers model (limits) and the host's token sums. */
export function UsagePane({ models }: { readonly models: Models }) {
  const cards = useStore(models.providers.cards);
  const state = useStore(models.agents.state);
  const providers: readonly UsageProvider[] | null =
    cards.kind === 'loaded'
      ? cards.value.filter(({ entry }) => entry.manifest.kind === 'provider').map(({ entry, info, usage }) => ({ id: entry.manifest.id, name: entry.manifest.name, enabled: entry.enabled, info, usage }))
      : null;
  return (
    <UsageSection
      providers={providers}
      onRefreshLimits={(id) => models.providers.refreshUsage(id)}
      loadTokens={(range) => models.api.tokenUsage(range)}
      agentName={(agentId) => (state.agents.kind === 'loaded' ? (state.agents.value.find(({ id }) => id === agentId)?.name ?? null) : null)}
    />
  );
}
