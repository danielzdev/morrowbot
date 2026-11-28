import type { ServerMode } from '../renderer/bridge.ts';
import type { HostSupervisor } from './host-supervisor.ts';
import type { HostTarget } from './ipc-proxy.ts';
import { targetOf, type RemoteChoice, type ServerPlan } from './server-choice.ts';

export interface ServerConnectionDeps {
  /** Starts this computer's own host. The only way a local host is ever started. */
  readonly startLocal: () => HostSupervisor;
  /** A joined server is in use: follow its events. */
  readonly connectRemote: (target: HostTarget) => void;
}

/** The server this app talks to for its whole run. Switching after the first choice saves it and relaunches instead. */
export interface ServerConnection {
  mode(): ServerMode;
  /** Where API calls go, or undefined while asking, or while the local host starts or is down. */
  target(): HostTarget | undefined;
  /** The first-launch choice, taken without a relaunch; false when a server is already in use. */
  choose(choice: { readonly kind: 'local' } | RemoteChoice): boolean;
  /** Stops the local host if this app started one; a joined server keeps running. */
  stop(): Promise<void>;
}

type State =
  | { readonly kind: 'asking' }
  | { readonly kind: 'local'; readonly host: HostSupervisor }
  | { readonly kind: 'remote'; readonly choice: RemoteChoice; readonly target: HostTarget };

export function openServerConnection(plan: ServerPlan, deps: ServerConnectionDeps): ServerConnection {
  const remote = (choice: RemoteChoice): State => {
    const target = targetOf(choice);
    deps.connectRemote(target);
    return { kind: 'remote', choice, target };
  };
  let state: State;
  switch (plan.kind) {
    case 'ask':
      state = { kind: 'asking' };
      break;
    case 'local':
      state = { kind: 'local', host: deps.startLocal() };
      break;
    case 'remote':
      state = remote(plan.choice);
      break;
  }
  return {
    mode: () => {
      switch (state.kind) {
        case 'asking':
          return { kind: 'choosing' };
        case 'local':
          return { kind: 'local' };
        case 'remote':
          return { kind: 'remote', url: state.choice.url, hostName: state.choice.hostName };
      }
    },
    target: () => {
      switch (state.kind) {
        case 'asking':
          return undefined;
        case 'local':
          return state.host.target();
        case 'remote':
          return state.target;
      }
    },
    choose: (choice) => {
      if (state.kind !== 'asking') return false;
      state = choice.kind === 'local' ? { kind: 'local', host: deps.startLocal() } : remote(choice);
      return true;
    },
    stop: async () => {
      if (state.kind === 'local') await state.host.stop();
    },
  };
}
