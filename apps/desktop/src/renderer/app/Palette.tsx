import type { Agent, Thread } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { CommandPalette, type PaletteItem } from '../features/palette/index.ts';
import { DESTINATIONS, type SettingsLink } from '../features/settings/index.ts';
import { PLATFORM, shortcutLabel, type ShortcutId } from '../shared/keys.ts';
import { Icon, type IconName } from '../shared/ui/Icon.tsx';
import { useStore } from '../shared/use-store.ts';
import type { Models } from './models.ts';

/** What the palette's rows do; the app owns every one of these. */
export interface PaletteActions {
  readonly newChat: (agentId: string) => void;
  readonly newAgent: () => void;
  readonly openSettings: (link: SettingsLink) => void;
  readonly openExtensions: () => void;
  readonly toggleSidebar: () => void;
  readonly openAgent: (agentId: string, threadId: string | null) => void;
  readonly recheck: (pluginId: string) => void;
}

const NO_CHATS_NOTE = 'Open an agent to search its chats.';

type ChatList = { readonly kind: 'loading' } | { readonly kind: 'loaded'; readonly threads: readonly Thread[] } | { readonly kind: 'failed' };

const icon = (name: IconName): ComponentChildren => <Icon name={name} />;
const hint = (id: ShortcutId): string => shortcutLabel(id, PLATFORM);

/**
 * ⌘K wired to the app (spec §3.5): actions, agents, every chat (from `GET /api/threads`, H9) and every
 * settings row. If the chat list can't load, it falls back to the chats this window has open and says so.
 */
export function Palette(props: {
  readonly models: Models;
  readonly agent: Agent | undefined;
  readonly avatar: (agent: Agent, size: number) => ComponentChildren;
  readonly actions: PaletteActions;
  readonly onClose: () => void;
  readonly onRun: (item: PaletteItem) => void;
}) {
  const { models, actions } = props;
  const state = useStore(models.agents.state);
  const cards = useStore(models.plugins.cards);
  const activity = useStore(models.chats.activity);
  const [chats, setChats] = useState<ChatList>({ kind: 'loading' });
  useEffect(() => {
    let current = true;
    void models.api.listAllThreads().then((result) => {
      if (current) setChats(result.kind === 'ok' ? { kind: 'loaded', threads: result.value.threads } : { kind: 'failed' });
    });
    return () => {
      current = false;
    };
  }, [models]);

  const agents = state.agents.kind === 'loaded' ? state.agents.value : [];
  const agentById = new Map(agents.map((each) => [each.id, each]));
  const opened = Object.values(state.threads).flatMap((list) => (list.kind === 'loaded' ? list.value : []));
  const threads = chats.kind === 'loaded' ? chats.threads : [...opened].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const titleOf = (threadId: string): string => threads.find(({ id }) => id === threadId)?.title ?? 'Chat';

  const action = (id: string, label: string, leading: IconName, run: () => void, shortcut: ShortcutId | null = null, detail = ''): PaletteItem => ({
    id: `action:${id}`,
    group: 'actions',
    label,
    detail,
    hint: shortcut === null ? '' : hint(shortcut),
    leading: icon(leading),
    run,
  });
  const { agent } = props;
  const approvals = Object.entries(activity).filter(([, each]) => each.activity === 'needs-approval');
  const providers = cards.kind === 'loaded' ? cards.value.filter(({ entry }) => entry.manifest.kind === 'provider' && entry.enabled) : [];

  const items: PaletteItem[] = [
    ...approvals.map(([threadId, each]) =>
      action(`approval:${threadId}`, 'Go to approval', 'warning', () => { actions.openAgent(each.agentId, threadId); }, null, `${agentById.get(each.agentId)?.name ?? 'Agent'} · ${titleOf(threadId)}`),
    ),
    ...(agent === undefined ? [] : [action('new-chat', `New chat with ${agent.name}`, 'chat', () => { actions.newChat(agent.id); }, 'new-chat')]),
    action('new-agent', 'New agent', 'plus', actions.newAgent, 'new-agent'),
    action('settings', 'Settings', 'settings', () => { actions.openSettings('general'); }, 'settings'),
    action('usage', 'Usage', 'gauge', () => { actions.openSettings('usage'); }, 'usage', 'Limits and tokens'),
    action('extensions', 'Extensions', 'plugins', actions.openExtensions, 'extensions'),
    action('toggle-sidebar', 'Toggle sidebar', 'sidebar', actions.toggleSidebar, 'toggle-sidebar'),
    ...providers.map(({ entry }) => action(`recheck:${entry.manifest.id}`, `Recheck ${entry.manifest.name}`, 'refresh', () => { actions.recheck(entry.manifest.id); })),
    ...agents.map((each): PaletteItem => ({
      id: `agent:${each.id}`,
      group: 'agents',
      label: each.name,
      detail: '',
      hint: '',
      leading: props.avatar(each, 20),
      run: () => { actions.openAgent(each.id, null); },
    })),
    ...threads.flatMap((thread): PaletteItem[] => {
      const owner = agentById.get(thread.agentId);
      if (owner === undefined) return [];
      return [{ id: `chat:${thread.id}`, group: 'chats', label: thread.title, detail: owner.name, hint: '', leading: icon('chat'), run: () => { actions.openAgent(owner.id, thread.id); } }];
    }),
    ...DESTINATIONS.map((place): PaletteItem => ({
      id: `setting:${place.link}`,
      group: 'settings',
      label: place.label,
      detail: place.section,
      hint: '',
      leading: icon('settings'),
      run: () => { actions.openSettings(place.link); },
    })),
  ];

  return <CommandPalette items={items} note={chats.kind === 'failed' ? NO_CHATS_NOTE : null} onClose={props.onClose} onRun={props.onRun} />;
}
