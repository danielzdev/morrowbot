import type { Agent } from '@morrowbot/contracts';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../bridge.ts';
import { Sidebar } from '../features/agents/index.ts';
import { BotAvatar, combineActivity, motionOf } from '../features/avatar/index.ts';
import { chatMarkdown } from '../features/chat/index.ts';
import { pluginAlert } from '../features/plugins/index.ts';
import { ProvidersSection } from '../features/providers/index.ts';
import { SettingsModal, type SettingsLink } from '../features/settings/index.ts';
import { AppInfo, redact } from '../shared/privacy.ts';
import { useStore } from '../shared/use-store.ts';
import { liveFactsOf } from './derive.ts';
import { createModels } from './models.ts';
import { Pages, type Page } from './Pages.tsx';
import { Shell } from './Shell.tsx';

const NO_INFO: AppInfo = { appVersion: '', homeDir: '', userName: '', dataDir: '' };

export function App({ bridge }: { readonly bridge: MorrowbotBridge }) {
  const models = useMemo(() => createModels(bridge), [bridge]);
  const [page, setPage] = useState<Page>({ kind: 'chat' });
  const [settings, setSettings] = useState<SettingsLink | null>(null);
  const [filterRequest, setFilterRequest] = useState(0);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const copies = useRef(0);
  const state = useStore(models.agents.state);
  const cards = useStore(models.providers.cards);
  const pluginList = useStore(models.plugins.list);
  const activity = useStore(models.chats.activity);
  const appearance = useStore(models.appearance.state);
  useEffect(() => {
    void models.agents.load();
    void models.providers.load();
    void models.plugins.load();
    void bridge.appInfo().then((reply) => {
      const parsed = AppInfo.safeParse(reply);
      if (parsed.success) setInfo(parsed.data);
    });
    return () => {
      models.chats.close();
      models.providers.close();
      models.plugins.close();
      models.agents.close();
      models.appearance.close();
    };
  }, [models]);

  const agent = state.agents.kind === 'loaded' ? state.agents.value.find(({ id }) => id === state.selectedAgentId) : undefined;
  const safe = (text: string): string => redact(text, info ?? NO_INFO);
  const preview = (text: string): string => (info === null ? '…' : safe(text));
  const avatarOf = (each: Agent, size: number) => {
    const motion = motionOf(combineActivity(Object.values(activity).filter((one) => one.agentId === each.id).map((one) => one.activity)));
    return <BotAvatar avatar={each.avatar} motion={motion} size={size} reducedMotion={appearance.reducedMotion} />;
  };
  /** The one way to open Settings: the sidebar, ⌘, and later the palette and banners all pass a link here. */
  const openSettings = (link: SettingsLink): void => {
    setSettings(link);
  };
  const agentsUsing = (providerId: string): readonly string[] =>
    state.agents.kind === 'loaded' ? state.agents.value.filter(({ provider }) => provider.kind === 'bound' && provider.pluginId === providerId).map(({ name }) => name) : [];
  const newChat = (agentId: string): void => {
    models.agents.selectAgent(agentId);
    setPage({ kind: 'chat' });
    void models.agents.newThread(agentId).then(() => {
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
    });
  };
  const copyChat = (threadId: string): void => {
    const screen = models.chats.session(threadId).screen;
    const mine = ++copies.current;
    const copy = (): boolean => {
      const view = screen.get().view;
      if (mine !== copies.current) return true;
      if (view.kind === 'loading') return false;
      if (view.kind === 'loaded' && agent !== undefined) void bridge.copyText(chatMarkdown(view.value.thread.title, agent.name, view.value.messages, safe));
      return true;
    };
    if (copy()) return;
    const stop = screen.subscribe(() => {
      if (copy()) stop();
    });
  };

  return (
    <>
      <Shell
        onShortcut={(id) => {
          if (id === 'new-chat' && agent !== undefined) newChat(agent.id);
          if (id === 'new-agent') setPage({ kind: 'new-agent' });
          if (id === 'settings') openSettings('general');
          if (id === 'filter-agents') setFilterRequest((count) => count + 1);
          if (id === 'extensions') setPage({ kind: 'extensions' });
        }}
        sidebar={(mode, controls) => (
          <Sidebar
            model={models.agents}
            mode={mode}
            facts={(each) => liveFactsOf(cards, activity, each)}
            avatar={avatarOf}
            redact={preview}
            alert={pluginList.kind === 'loaded' ? pluginAlert(pluginList.value) : null}
            filterRequest={filterRequest}
            onToggle={controls.toggle}
            onOpenAgent={(agentId, threadId) => {
              models.agents.selectAgent(agentId);
              if (threadId !== null) models.agents.openThread(agentId, threadId);
              setPage({ kind: 'chat' });
              controls.dismiss();
            }}
            onNewChat={(agentId) => { newChat(agentId); controls.dismiss(); }}
            onAgentSettings={(agentId) => { models.agents.selectAgent(agentId); setPage({ kind: 'agent-settings' }); controls.dismiss(); }}
            onNewAgent={() => { setPage({ kind: 'new-agent' }); controls.dismiss(); }}
            onSettings={() => { openSettings('general'); }}
            onExtensions={() => { setPage({ kind: 'extensions' }); controls.dismiss(); }}
          />
        )}
        main={(chrome) => (
          <>
            {state.problem !== null && (
              <div class="banner danger" role="alert">
                <span>{safe(state.problem)}</span>
                <button class="btn ghost" onClick={() => { models.agents.dismissProblem(); }}>Dismiss</button>
              </div>
            )}
            <Pages page={page} onPage={setPage} models={models} bridge={bridge} agent={agent} chrome={chrome} info={info} reducedMotion={appearance.reducedMotion} onCopy={copyChat} onNewChat={newChat} onOpenSettings={openSettings} />
          </>
        )}
      />
      {settings !== null && (
        <SettingsModal
          key={settings}
          link={settings}
          onClose={() => { setSettings(null); }}
          appearance={models.appearance}
          chatPrefs={models.chatPrefs}
          info={info}
          bridge={bridge}
          providers={(slot) => (
            <ProvidersSection
              model={models.providers}
              info={info}
              bridge={bridge}
              initial={slot.initial}
              onTrail={slot.onTrail}
              agentsUsing={agentsUsing}
              onOpenExtensions={() => {
                setSettings(null);
                setPage({ kind: 'extensions' });
              }}
            />
          )}
        />
      )}
    </>
  );
}
