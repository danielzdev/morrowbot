import { acp } from '@morrowbot/plugin-sdk';
import { MODEL } from './models.ts';
import { SessionNewResponse } from './protocol.ts';
import { closeSession, vendorError } from './session.ts';
import type { Live } from './turn.ts';

/**
 * Learns what agy shows only inside a session, before any turn: whether the user is signed in, the
 * plan, the models, and each model's thinking levels (they differ by model). It opens a session in
 * `cwd` that never prompts, sets each model on it in turn, and closes it, all by `deadline` (ms since
 * the epoch). agy keeps no model change across sessions, so the next session still starts on agy's
 * default. A model agy refuses to switch to is skipped. `live.probed` is set once every model was
 * tried; until then the next provider-info probes again.
 */
export async function probeSession(live: Live, cwd: string, deadline: number): Promise<void> {
  const { daemon, catalog } = live;
  const left = (): number => Math.max(1, deadline - Date.now());
  const created = await daemon.call('session/new', { cwd, mcpServers: [] }, SessionNewResponse, left());
  if (created.kind === 'error' && vendorError(created.code, created.message).kind === 'signed-out') live.signedOut = true;
  if (created.kind !== 'ok') return;
  const { sessionId, configOptions, _meta } = created.value;
  live.signedOut = false;
  live.tier = _meta?.antigravity?.tier?.name ?? live.tier;
  try {
    const options = configOptions ?? [];
    catalog.observe(options, true);
    const model = acp.selectOf(options, MODEL);
    for (const { value } of model?.values ?? []) {
      if (value === model?.current) continue;
      if (Date.now() >= deadline) return;
      const reply = await daemon.call('session/set_config_option', { sessionId, configId: MODEL, value }, acp.SetConfigResponse, left());
      if (reply.kind === 'unanswered') return;
      if (reply.kind === 'ok') catalog.observe(reply.value.configOptions, false);
    }
    live.probed = true;
  } finally {
    closeSession(daemon, sessionId);
  }
}
