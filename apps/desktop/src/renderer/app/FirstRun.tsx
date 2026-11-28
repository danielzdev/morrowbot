import type { MorrowbotBridge } from '../bridge.ts';
import { Welcome } from '../features/onboarding/index.ts';
import { engineRows, SETUP_GUIDE_URL } from '../features/providers/index.ts';
import { prefill } from '../shared/binding-ui/selection.ts';
import { parseLaunch, type EngineRow } from '../shared/engine-setup.ts';
import { PLATFORM } from '../shared/keys.ts';
import { redact, type AppInfo } from '../shared/privacy.ts';
import type { Loadable } from '../shared/store.ts';
import { useRecheckOnReturn } from '../shared/use-recheck-on-return.ts';
import { useStore } from '../shared/use-store.ts';
import type { NewAgentBrain } from './AgentDialogs.tsx';
import { providerChoicesOf } from './derive.ts';
import type { Models } from './models.ts';

/** The first-launch canvas (spec §7): Welcome over the live provider list, with one-click sign-in on macOS. */
export function FirstRun(props: { readonly models: Models; readonly bridge: MorrowbotBridge; readonly info: AppInfo | null; readonly onFirstAgent: (brain: NewAgentBrain) => void }) {
  const { models, bridge, info } = props;
  const cards = useStore(models.providers.cards);
  const recheckLater = useRecheckOnReturn((id) => void models.providers.recheck(id));
  const engines: Loadable<readonly EngineRow[]> =
    info === null || cards.kind === 'loading'
      ? { kind: 'loading' }
      : cards.kind === 'failed'
        ? { kind: 'failed', message: redact(cards.message, info) }
        : { kind: 'loaded', value: engineRows(cards.value, info, PLATFORM === 'mac') };
  const first = prefill(providerChoicesOf(cards));
  return (
    <Welcome
      engines={engines}
      firstEngine={first?.name ?? null}
      actions={{
        signIn: async (id) => {
          recheckLater(id);
          const launch = parseLaunch(await bridge.signInTerminal(id));
          return launch.kind === 'opened' ? null : launch.reason;
        },
        copy: (id, text) => {
          recheckLater(id);
          return bridge.copyText(text);
        },
        openGuide: (id, url) => {
          recheckLater(id);
          void bridge.openExternal(url);
        },
        recheck: (id) => void models.providers.recheck(id),
        turnOn: (id) => void models.providers.setEnabled(id, true),
      }}
      onCreate={() => { props.onFirstAgent('prefill'); }}
      onSkip={() => { props.onFirstAgent('unbound'); }}
      onOpenGuide={() => void bridge.openExternal(SETUP_GUIDE_URL)}
    />
  );
}
