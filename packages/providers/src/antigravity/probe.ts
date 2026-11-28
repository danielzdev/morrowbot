import { acp } from '@morrowbot/plugin-sdk';
import { MODEL } from './models.ts';
import { SessionNewResponse } from './protocol.ts';
import { closeSession, vendorError } from './session.ts';
import type { Live } from './turn.ts';

/** The whole probe stays well under the host's 30 s provider-info deadline: agy 1.5.18 takes about 1 s. */
const PROBE_MS = 10_000;

/**
 * Learns what agy shows only inside a session, before any turn: whether the user is signed in, the
 * plan, the models, and each model's thinking levels (they differ by model). It opens a session in
 * `cwd` that never prompts, sets each model on it in turn, and closes it. agy keeps no model change
 * across sessions, so the next session still starts on agy's default. A model the deadline cuts off
 * gets its thinking levels from its first turn instead.
 */
export async function probeSession(live: Live, cwd: string): Promise<void> {
  const { daemon, catalog } = live;
  const deadline = Date.now() + PROBE_MS;
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
    if (model === null) return;
    for (const { value } of model.values) {
      if (value === model.current) continue;
      if (Date.now() >= deadline) return;
      const reply = await daemon.call('session/set_config_option', { sessionId, configId: MODEL, value }, acp.SetConfigResponse, left());
      if (reply.kind !== 'ok') return;
      catalog.observe(reply.value.configOptions, false);
    }
  } finally {
    closeSession(daemon, sessionId);
  }
}
