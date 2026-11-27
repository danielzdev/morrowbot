import { HostMessage, PROTOCOL_VERSION, type PluginMessage, type TurnChunk, type TurnEnd, type TurnRequest } from '@morrowbot/contracts';
import { createTurnApprovals, type TurnApprovals } from './approvals.ts';
import { stopAllCommands, stopTurnCommands } from './command.ts';
import { ackGroup, connectHost, killGroup } from './host-link.ts';
import type { PluginDefinition, ProviderPlugin } from './plugin.ts';

type Send = (message: PluginMessage, done?: () => void) => void;
interface RunningTurn {
  readonly controller: AbortController;
  readonly approvals: TurnApprovals;
}
type Turns = Map<string, RunningTurn>;

/**
 * Serves a plugin over the IPC channel the host opened (wire protocol v1). Call it once from the
 * plugin's entry file. The process exits when the host shuts it down or goes away.
 */
export function runPlugin(plugin: PluginDefinition): void {
  const send = ipcSender();
  const turns: Turns = new Map();
  connectHost((message) => {
    send(message);
  });
  process.on('disconnect', () => process.exit(0));
  process.on('message', (raw: unknown) => {
    const parsed = HostMessage.safeParse(raw);
    if (!parsed.success) {
      console.error(`MorrowBot plugin: ignored a malformed host message: ${parsed.error.message}`);
      return;
    }
    handle(plugin, parsed.data, send, turns);
  });
}

function ipcSender(): Send {
  const channel = process.send?.bind(process);
  if (channel === undefined) {
    throw new Error('This plugin must be started by the MorrowBot host (no IPC channel found).');
  }
  return (message, done) => {
    channel(message, undefined, undefined, () => done?.());
  };
}

function handle(plugin: PluginDefinition, message: HostMessage, send: Send, turns: Turns): void {
  switch (message.kind) {
    case 'turn':
      void runTurn(plugin, message, send, turns);
      return;
    case 'cancel':
      turns.get(message.turnId)?.controller.abort();
      return;
    case 'approval-reply':
      if (turns.get(message.turnId)?.approvals.reply(message.approvalId, message.choiceId) !== true) {
        console.error(`MorrowBot plugin: ignored a stale or unknown approval reply for ${message.approvalId}`);
      }
      return;
    case 'child-group-ack':
      ackGroup(message.pgid);
      return;
    case 'kill-child-group':
      killGroup(message.pgid);
      return;
    case 'init':
    case 'health':
    case 'shutdown':
    case 'provider-info':
    case 'usage':
    case 'route-info':
      void answer(plugin, message, send, turns).catch((error: unknown) => {
        send(failure(message.id, error));
      });
      return;
  }
}

type Request = Extract<HostMessage, { id: number }>;

async function answer(plugin: PluginDefinition, message: Request, send: Send, turns: Turns): Promise<void> {
  const { id } = message;
  switch (message.kind) {
    case 'init':
      await plugin.init?.({ config: message.config, dataDir: message.dataDir });
      send({ kind: 'init-result', id, protocolVersion: PROTOCOL_VERSION, pluginKind: plugin.kind });
      return;
    case 'health':
      send({ kind: 'health-result', id, health: plugin.health ? await plugin.health() : { kind: 'ok' } });
      return;
    case 'shutdown': {
      for (const { controller } of turns.values()) controller.abort();
      let reply: PluginMessage = { kind: 'shutdown-result', id };
      try {
        await stopAllCommands();
        await plugin.shutdown?.();
      } catch (error) {
        reply = failure(id, error);
      }
      send(reply, () => process.exit(0));
      return;
    }
    case 'provider-info':
      send({ kind: 'provider-info-result', id, info: await provider(plugin).providerInfo({ refresh: message.refresh }) });
      return;
    case 'usage':
      send({ kind: 'usage-result', id, usage: await provider(plugin).usage({ refresh: message.refresh }) });
      return;
    case 'route-info': {
      const route = await provider(plugin).routeInfo({ cwd: message.cwd });
      switch (route.kind) {
        case 'known':
          send({ kind: 'route-info-result', id, accountKey: route.accountKey, routeKey: route.routeKey });
          return;
        case 'failed':
          send({ kind: 'route-info-failed', id, reason: route.reason });
          return;
      }
    }
  }
}

function provider(plugin: PluginDefinition): ProviderPlugin {
  switch (plugin.kind) {
    case 'provider':
      return plugin;
    case 'tool':
      throw new UnsupportedError('Tool plugins do not run provider requests');
  }
}

async function runTurn(
  plugin: PluginDefinition,
  message: Extract<HostMessage, { kind: 'turn' }>,
  send: Send,
  turns: Turns,
): Promise<void> {
  const request = requestOf(message);
  const { turnId } = request;
  if (turns.has(turnId)) {
    console.error(`MorrowBot plugin: ignored a second turn with id ${turnId}`);
    return;
  }
  const controller = new AbortController();
  let ended = false;
  const emit = (chunk: TurnChunk): void => {
    if (!ended) send({ kind: 'turn-chunk', turnId, chunk });
  };
  const approvals = createTurnApprovals({ mode: request.mode, emit });
  turns.set(turnId, { controller, approvals });
  let end: TurnEnd;
  try {
    end = await provider(plugin).turn({ request, signal: controller.signal, emit, ask: (ask) => approvals.ask(ask) });
  } catch (error) {
    end = {
      outcome: controller.signal.aborted
        ? { kind: 'cancelled' }
        : { kind: 'failed', error: { kind: 'other', message: describe(error) } },
      usage: { kind: 'unavailable' },
      actualModel: null,
      accountKey: request.expectedAccountKey,
      sessionTouched: true,
      finalText: null,
    };
  } finally {
    ended = true;
    approvals.close();
    turns.delete(turnId);
  }
  await stopTurnCommands(turnId);
  send({ kind: 'turn-end', turnId, ...end });
}

/** The turn frame, already parsed at the IPC boundary, without its `kind`. */
function requestOf(message: Extract<HostMessage, { kind: 'turn' }>): TurnRequest {
  const { turnId, cwd, mode, access, vendorSettings, expectedAccountKey, expectedRouteKey, selection, session, system, prompt } = message;
  return { turnId, cwd, mode, access, vendorSettings, expectedAccountKey, expectedRouteKey, selection, session, system, prompt };
}

class UnsupportedError extends Error {}

function failure(id: number, error: unknown): PluginMessage {
  return { kind: 'error', id, code: error instanceof UnsupportedError ? 'unsupported' : 'failed', message: describe(error) };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
