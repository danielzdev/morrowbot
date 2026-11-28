import { useEffect, useState } from 'preact/hooks';
import type { MorrowbotBridge, ServerMode as ServerModeType } from '../bridge.ts';
import { ChooseServer } from '../features/onboarding/index.ts';
import type { ServerRole } from '../features/settings/index.ts';
import { createApi } from '../shared/api.ts';
import { answerProblem, ServerMode } from '../shared/server.ts';
import { App } from './App.tsx';

type Started = { readonly kind: 'loading' } | { readonly kind: 'choosing' } | { readonly kind: 'ready'; readonly server: Exclude<ServerModeType, { kind: 'choosing' }>; readonly role: ServerRole };

/** Who this app is on a joined server; its own server's owner otherwise, or until the server answers. */
async function roleOn(bridge: MorrowbotBridge, server: Exclude<ServerModeType, { kind: 'choosing' }>): Promise<ServerRole> {
  if (server.kind === 'local') return 'owner';
  const me = await createApi(bridge).whoAmI();
  if (me.kind === 'failed' || me.value.kind === 'owner') return 'owner';
  return me.value.access.kind === 'co-owner' ? 'co-owner' : 'scoped';
}

/** The window: on first launch, where agents live (Welcome's server choice); afterwards the app on that server. */
export function Root({ bridge }: { readonly bridge: MorrowbotBridge }) {
  const [started, setStarted] = useState<Started>({ kind: 'loading' });
  const load = async (): Promise<void> => {
    const parsed = ServerMode.safeParse(await bridge.serverMode());
    const server: ServerModeType = parsed.success ? parsed.data : { kind: 'local' };
    if (server.kind === 'choosing') {
      setStarted({ kind: 'choosing' });
      return;
    }
    setStarted({ kind: 'ready', server, role: await roleOn(bridge, server) });
  };
  useEffect(() => {
    void load();
  }, []);
  switch (started.kind) {
    case 'loading':
      return null;
    case 'choosing': {
      const choose = async (request: Parameters<MorrowbotBridge['chooseServer']>[0]): Promise<string | null> => {
        const problem = answerProblem(await bridge.chooseServer(request));
        if (problem === null) await load();
        return problem;
      };
      return <ChooseServer onStart={() => choose({ kind: 'local' })} onJoin={(fields) => choose({ kind: 'join', ...fields })} />;
    }
    case 'ready':
      return <App bridge={bridge} server={started.server} role={started.role} />;
  }
}
