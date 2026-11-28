import type { Agent } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../bridge.ts';
import { Welcome } from '../features/onboarding/index.ts';
import { engineRows, SETUP_GUIDE_URL } from '../features/providers/index.ts';
import { prefill } from '../shared/binding-ui/selection.ts';
import { openExternalLink, parseLaunch, type EngineRow } from '../shared/engine-setup.ts';
import { PLATFORM } from '../shared/keys.ts';
import { redact, type AppInfo } from '../shared/privacy.ts';
import type { Loadable } from '../shared/store.ts';
import { useRecheckOnReturn } from '../shared/use-recheck-on-return.ts';
import { useStore } from '../shared/use-store.ts';
import { providerChoicesOf } from './derive.ts';
import type { Models } from './models.ts';
import { NewAgent } from './NewAgent.tsx';

/**
 * First-run setup (spec §7), the whole window until the first agent exists: Welcome over the live provider
 * list, with 1-click install and macOS Terminal sign-in, then New Agent. `onDone` runs once that agent is
 * created and any full-access notice is closed.
 */
export function FirstRun(props: {
  readonly models: Models;
  readonly bridge: MorrowbotBridge;
  readonly info: AppInfo | null;
  readonly reducedMotion: boolean;
  /** True only for the server's owner, who may grant full access (shell commands). */
  readonly allowFull: boolean;
  readonly onDone: (agent: Agent) => void;
}) {
  const { models, bridge, info } = props;
  const cards = useStore(models.providers.cards);
  const capabilities = useStore(models.providers.installCapabilities);
  const recheckLater = useRecheckOnReturn((id) => void models.providers.recheck(id));
  const safe = (text: string): string => (info === null ? text : redact(text, info));
  const engines: Loadable<readonly EngineRow[]> =
    info === null || cards.kind === 'loading'
      ? { kind: 'loading' }
      : cards.kind === 'failed'
        ? { kind: 'failed', message: redact(cards.message, info) }
        : { kind: 'loaded', value: engineRows(cards.value, info, PLATFORM === 'mac', capabilities) };
  const first = prefill(providerChoicesOf(cards));
  return (
    <div class="first-run">
      <div class="choose-drag drag" aria-hidden="true" />
      <Welcome
        engines={engines}
        firstEngine={first?.name ?? null}
        actions={{
          signIn: async (id) => {
            recheckLater(id);
            const launch = parseLaunch(await bridge.signInTerminal(id));
            return launch.kind === 'opened' ? null : safe(launch.reason);
          },
          copy: (id, text) => {
            recheckLater(id);
            return bridge.copyText(text);
          },
          openGuide: async (id, url) => {
            const reason = await openExternalLink(bridge, url);
            if (reason === null) recheckLater(id);
            return reason === null ? null : safe(reason);
          },
          install: async (id) => {
            const result = await models.providers.install(id, 'install');
            return result.kind === 'failed' ? { ...result, reason: safe(result.reason) } : result;
          },
          cancelInstall: (id) => models.providers.cancelInstall(id),
          recheck: (id) => void models.providers.recheck(id),
          turnOn: (id) => void models.providers.setEnabled(id, true),
        }}
        agentStep={(step) => (
          <NewAgent
            layout={{ kind: 'page', head: step.head, onBack: step.back, createLabel: step.createLabel }}
            models={models}
            bridge={bridge}
            info={info}
            reducedMotion={props.reducedMotion}
            allowFull={props.allowFull}
            onOpenProviders={step.back}
            onCreated={props.onDone}
          />
        )}
        onOpenGuide={async () => {
          const reason = await openExternalLink(bridge, SETUP_GUIDE_URL);
          return reason === null ? null : safe(reason);
        }}
      />
    </div>
  );
}
