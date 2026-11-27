import type { Agent } from '@morrowbot/contracts';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../bridge.ts';
import { Sidebar } from '../features/agents/index.ts';
import { BotAvatar, combineActivity, motionOf } from '../features/avatar/index.ts';
import { chatMarkdown } from '../features/chat/index.ts';
import type { PaletteItem } from '../features/palette/index.ts';
import { pluginAlert } from '../features/plugins/index.ts';
import { SettingsModal, type SettingsLink } from '../features/settings/index.ts';
import { AppInfo, redact } from '../shared/privacy.ts';
import { useStore } from '../shared/use-store.ts';
import { entriesOf, liveFactsOf } from './derive.ts';
import { createModels } from './models.ts';
import { AgentDialogs, type AgentDialog } from './AgentDialogs.tsx';
import { Pages, type Page } from './Pages.tsx';
import { Palette } from './Palette.tsx';
import { Shell } from './Shell.tsx';
import { UsagePane } from './UsagePane.tsx';

const NO_INFO: AppInfo = { appVersion: '', homeDir: '', userName: '', dataDir: '' };

const FOCUS_WAIT_MS = 2_000;

/**
 * Keeps the chat's message box focused for up to two seconds while the chosen chat loads and its
 * box mounts (possibly more than once). Stops as soon as focus is anywhere but the page or a box.
 */
function focusComposer(until = performance.now() + FOCUS_WAIT_MS): void {
  requestAnimationFrame((now) => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && !active.matches('.composer textarea')) return;
    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
    if (now < until) focusComposer(until);
  });
}

export function App({ bridge }: { readonly bridge: MorrowbotBridge }) {
  const models = useMemo(() => createModels(bridge), [bridge]);
  const [page, setPage] = useState<Page>({ kind: 'chat' });
  const [settings, setSettings] = useState<SettingsLink | null>(null);
  const [filterRequest, setFilterRequest] = useState(0);
  const [palette, setPalette] = useState(false);
  /** A palette pick runs once the palette has closed and handed focus back, so what it opens returns focus there too. */
  const picked = useRef<PaletteItem | null>(null);
  const [findRequest, setFindRequest] = useState(0);
  const [approvalFocus, setApprovalFocus] = useState<string | null>(null);
  const [bindingRequest, setBindingRequest] = useState(0);
  const [dialog, setDialog] = useState<AgentDialog | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const copies = useRef(0);
  const state = useStore(models.agents.state);
  const cards = useStore(models.plugins.cards);
  const activity = useStore(models.chats.activity);
  const appearance = useStore(models.appearance.state);
  useEffect(() => {
    void models.agents.load();
    void models.plugins.load();
    void bridge.appInfo().then((reply) => {
      const parsed = AppInfo.safeParse(reply);
      if (parsed.success) setInfo(parsed.data);
    });
    return () => {
      models.chats.close();
      models.plugins.close();
      models.agents.close();
      models.appearance.close();
    };
  }, [models]);

  useEffect(() => {
    if (palette || picked.current === null) return;
    const item = picked.current;
    picked.current = null;
    item.run();
  }, [palette]);

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
  const openAgent = (agentId: string, threadId: string | null): void => {
    models.agents.selectAgent(agentId);
    if (threadId !== null) models.agents.openThread(agentId, threadId);
    setApprovalFocus(threadId);
    setPage({ kind: 'chat' });
  };
  const newChat = (agentId: string): void => {
    models.agents.selectAgent(agentId);
    setPage({ kind: 'chat' });
    void models.agents.newThread(agentId).then(() => {
      focusComposer();
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
          if (id === 'palette') setPalette(true);
          if (id === 'usage') openSettings('usage');
          if (id === 'new-chat' && agent !== undefined) newChat(agent.id);
          if (id === 'new-agent') setDialog({ kind: 'new-agent' });
          if (id === 'binding') setBindingRequest((count) => count + 1);
          if (id === 'settings') openSettings('general');
          if (id === 'filter-agents') setFilterRequest((count) => count + 1);
          if (id === 'extensions') setPage({ kind: 'plugins' });
          if (id === 'find' && page.kind === 'chat') setFindRequest((count) => count + 1);
        }}
        sidebar={(mode, controls) => (
          <Sidebar
            model={models.agents}
            mode={mode}
            facts={(each) => liveFactsOf(cards, activity, each)}
            avatar={avatarOf}
            redact={preview}
            alert={pluginAlert(entriesOf(cards))}
            filterRequest={filterRequest}
            onToggle={controls.toggle}
            onOpenAgent={(agentId, threadId) => {
              openAgent(agentId, threadId);
              controls.dismiss();
            }}
            onNewChat={(agentId) => { newChat(agentId); controls.dismiss(); }}
            onAgentSettings={(agentId) => { setDialog({ kind: 'agent-settings', agentId, section: 'general' }); controls.dismiss(); }}
            onNewAgent={() => { setDialog({ kind: 'new-agent' }); controls.dismiss(); }}
            onSettings={() => { openSettings('general'); }}
            onUsage={() => { openSettings('usage'); }}
            onExtensions={() => { setPage({ kind: 'plugins' }); controls.dismiss(); }}
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
            {palette && (
              <Palette
                models={models}
                agent={agent}
                avatar={avatarOf}
                actions={{
                  newChat,
                  newAgent: () => { setDialog({ kind: 'new-agent' }); },
                  changeBinding: page.kind === 'chat' && agent !== undefined ? () => { setBindingRequest((count) => count + 1); } : null,
                  openSettings,
                  openExtensions: () => { setPage({ kind: 'plugins' }); },
                  toggleSidebar: chrome.showSidebar,
                  openAgent: (agentId, threadId) => {
                    openAgent(agentId, threadId);
                    focusComposer();
                  },
                  recheck: (pluginId) => {
                    setPage({ kind: 'plugins' });
                    void models.plugins.recheck(pluginId);
                  },
                }}
                onClose={() => { setPalette(false); }}
                onRun={(item) => {
                  picked.current = item;
                  setPalette(false);
                }}
              />
            )}
            <Pages
              page={page}
              onPage={setPage}
              models={models}
              bridge={bridge}
              agent={agent}
              chrome={chrome}
              info={info}
              reducedMotion={appearance.reducedMotion}
              findRequest={findRequest}
              bindingRequest={bindingRequest}
              approvalFocus={approvalFocus}
              onApprovalFocused={() => { setApprovalFocus(null); }}
              onAgentSettings={(agentId, section) => { setDialog({ kind: 'agent-settings', agentId, section }); }}
              onNewAgent={() => { setDialog({ kind: 'new-agent' }); }}
              onCopy={copyChat}
              onNewChat={newChat}
            />
          </>
        )}
      />
      <AgentDialogs
        dialog={dialog}
        onDialog={setDialog}
        models={models}
        bridge={bridge}
        info={info}
        reducedMotion={appearance.reducedMotion}
        onOpenProviders={() => { setPage({ kind: 'plugins' }); }}
        onCreated={(created) => { newChat(created.id); }}
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
          usage={<UsagePane models={models} />}
        />
      )}
    </>
  );
}
