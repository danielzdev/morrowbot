import { useEffect } from 'preact/hooks';
import type { MorrowbotBridge } from '../bridge.ts';
import { BotAvatar } from '../features/avatar/index.ts';
import { ConnectorsTab, matching, type ConnectorTarget } from '../features/connectors/index.ts';
import { ExtensionsView } from '../features/plugins/index.ts';
import { redact, type AppInfo } from '../shared/privacy.ts';
import { useStore } from '../shared/use-store.ts';
import type { Models } from './models.ts';

/** Where another screen sends the user in Extensions; each new `id` is one visit. */
export interface ExtensionsJump {
  readonly id: number;
  readonly target: ConnectorTarget;
}

/** Extensions, with the Connectors tab drawn by the connectors feature. */
export function ExtensionsPage(props: {
  readonly models: Models;
  readonly bridge: MorrowbotBridge;
  readonly info: AppInfo | null;
  readonly reducedMotion: boolean;
  readonly jump: ExtensionsJump | null;
  readonly onOpenProvider: (providerId: string) => void;
  readonly onLeaveCheck: (check: ((action: () => void) => void) | null) => void;
  readonly onExit: () => void;
}) {
  const { models, info, jump } = props;
  const { connectors } = models;
  const list = useStore(connectors.list);
  const state = useStore(models.agents.state);
  useEffect(() => {
    void connectors.load();
  }, [connectors]);
  const agents = state.agents.kind === 'loaded' ? state.agents.value : [];
  const safe = (text: string): string => (info === null ? '…' : redact(text, info));
  return (
    <ExtensionsView
      model={models.plugins}
      info={info}
      bridge={props.bridge}
      connectors={{
        count: (query) => (list.kind === 'loaded' ? matching(list.value.connectors, query).length : null),
        tab: (slot) => (
          <ConnectorsTab
            model={connectors}
            agents={agents}
            avatar={(agent, size) => <BotAvatar avatar={agent.avatar} size={size} reducedMotion={props.reducedMotion} />}
            redact={safe}
            {...slot}
          />
        ),
      }}
      jump={jump === null ? null : { id: jump.id, arrive: () => { connectors.arrive(jump.target); } }}
      onOpenProvider={props.onOpenProvider}
      onLeaveCheck={props.onLeaveCheck}
      onExit={props.onExit}
    />
  );
}
