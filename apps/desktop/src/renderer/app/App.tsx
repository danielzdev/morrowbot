import type { Agent } from '@morrowbot/contracts';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MorrowbotBridge, ServerMode } from '../bridge.ts';
import { Sidebar } from '../features/agents/index.ts';
import { BotAvatar, combineActivity, motionOf } from '../features/avatar/index.ts';
import { chatMarkdown } from '../features/chat/index.ts';
import type { PaletteItem } from '../features/palette/index.ts';
import { pluginAlert } from '../features/plugins/index.ts';
import { ProvidersSection } from '../features/providers/index.ts';
import { hiddenSections, SettingsModal, type ServerRole, type SettingsLink } from '../features/settings/index.ts';
import { AppInfo, redact } from '../shared/privacy.ts';
import { answerProblem } from '../shared/server.ts';
import { useStore } from '../shared/use-store.ts';
import { liveFactsOf } from './derive.ts';
import { createModels } from './models.ts';
import { AgentDialogs, type AgentDialog } from './AgentDialogs.tsx';
import { Pages, type Page } from './Pages.tsx';
import { Palette } from './Palette.tsx';
import { Shell } from './Shell.tsx';
import { UpdateBanner } from './UpdateBanner.tsx';
import { useAttention } from './use-attention.ts';
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

export interface AppProps {
  readonly bridge: MorrowbotBridge;
  readonly server: Exclude<ServerMode, { kind: 'choosing' }>;
  /** A scoped member sees only its shared agents: no New agent, engines, usage or Extensions. */
  readonly role: ServerRole;
}

export function App({ bridge, server, role }: AppProps) {
  const models = useMemo(() => createModels(bridge), [bridge]);
  const owner = role !== 'scoped';
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
  const [inspector, setInspector] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const copies = useRef(0);
  const state = useStore(models.agents.state);
  const cards = useStore(models.providers.cards);
  const pluginList = useStore(models.plugins.list);
  const activity = useStore(models.chats.activity);
  const appearance = useStore(models.appearance.state);
  const update = useStore(models.updates.status);
  const { notify } = useStore(models.chatPrefs.state);
  useEffect(() => {
    void models.agents.load();
    if (owner) {
      void models.providers.load();
      void models.plugins.load();
    }
    void bridge.appInfo().then((reply) => {
      const parsed = AppInfo.safeParse(reply);
      if (parsed.success) setInfo(parsed.data);
    });
    return () => {
      models.chats.close();
      models.providers.close();
      models.plugins.close();
      models.agents.close();
      models.routines.close();
      models.appearance.close();
      models.updates.close();
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
  const agentsUsing = (providerId: string): readonly string[] =>
    state.agents.kind === 'loaded' ? state.agents.value.filter(({ provider }) => provider.kind === 'bound' && provider.pluginId === providerId).map(({ name }) => name) : [];
  const openAgent = (agentId: string, threadId: string | null): void => {
    models.agents.selectAgent(agentId);
    if (threadId !== null) models.agents.openThread(agentId, threadId);
    setApprovalFocus(threadId);
    setPage({ kind: 'chat' });
  };
  const toggleInspector = (): void => {
    setInspector((open) => !open);
  };
  useAttention({ models, agentName: agent?.name ?? null, notify, safe, onOpen: openAgent });
  const newAgent = owner
    ? () => {
        setDialog({ kind: 'new-agent', brain: 'prefill' });
      }
    : null;
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
          if (id === 'usage' && owner) openSettings('usage');
          if (id === 'new-chat' && agent !== undefined) newChat(agent.id);
          if (id === 'new-agent') newAgent?.();
          if (id === 'binding') setBindingRequest((count) => count + 1);
          if (id === 'settings') openSettings('general');
          if (id === 'filter-agents') setFilterRequest((count) => count + 1);
          if (id === 'extensions' && owner) setPage({ kind: 'extensions' });
          if (id === 'find' && page.kind === 'chat') setFindRequest((count) => count + 1);
          if (id === 'inspector' && page.kind === 'chat' && agent !== undefined) toggleInspector();
        }}
        sidebar={(mode, controls) => (
          <Sidebar
            model={models.agents}
            notify={models.agentNotify}
            mode={mode}
            facts={(each) => liveFactsOf(cards, activity, each)}
            avatar={avatarOf}
            redact={preview}
            alert={pluginList.kind === 'loaded' ? pluginAlert(pluginList.value) : null}
            filterRequest={filterRequest}
            onToggle={controls.toggle}
            onOpenAgent={(agentId, threadId) => {
              openAgent(agentId, threadId);
              controls.dismiss();
            }}
            onNewChat={(agentId) => { newChat(agentId); controls.dismiss(); }}
            onAgentSettings={(agentId) => { setDialog({ kind: 'agent-settings', agentId, section: 'general' }); controls.dismiss(); }}
            onNewAgent={newAgent === null ? null : () => { newAgent(); controls.dismiss(); }}
            onSettings={() => { openSettings('general'); }}
            onUsage={owner ? () => { openSettings('usage'); } : null}
            onExtensions={owner ? () => { setPage({ kind: 'extensions' }); controls.dismiss(); } : null}
          />
        )}
        main={(chrome) => (
          <>
            <UpdateBanner status={update} onRestart={models.updates.restart} />
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
                  newAgent: () => { setDialog({ kind: 'new-agent', brain: 'prefill' }); },
                  changeBinding: page.kind === 'chat' && agent !== undefined ? () => { setBindingRequest((count) => count + 1); } : null,
                  openSettings,
                  openExtensions: () => { setPage({ kind: 'extensions' }); },
                  toggleSidebar: chrome.showSidebar,
                  toggleInspector: page.kind === 'chat' && agent !== undefined ? toggleInspector : null,
                  openAgent: (agentId, threadId) => {
                    openAgent(agentId, threadId);
                    focusComposer();
                  },
                  recheck: (pluginId) => {
                    openSettings(`providers/${pluginId}`);
                    void models.providers.recheck(pluginId);
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
              onNewAgent={newAgent}
              onCopy={copyChat}
              onNewChat={newChat}
              onOpenSettings={openSettings}
              inspectorOpen={inspector}
              onToggleInspector={toggleInspector}
              onFirstAgent={(brain) => { setDialog({ kind: 'new-agent', brain }); }}
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
        onOpenProviders={() => { openSettings('providers'); }}
        onCreated={(created) => { newChat(created.id); }}
      />
      {settings !== null && (
        <SettingsModal
          key={settings}
          link={settings}
          onClose={() => { setSettings(null); }}
          appearance={models.appearance}
          chatPrefs={models.chatPrefs}
          chatSettings={models.chatSettings}
          info={info}
          updates={models.updates}
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
          usage={<UsagePane models={models} />}
          pairing={models.api}
          members={{ ...models.api, copy: (text) => bridge.copyText(text) }}
          server={server}
          chooseServer={async (request) => answerProblem(await bridge.chooseServer(request))}
          hidden={hiddenSections(server.kind, role)}
        />
      )}
    </>
  );
}
