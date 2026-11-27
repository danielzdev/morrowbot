import { HostMessage, PROTOCOL_VERSION, type PluginMessage, type TurnChunk, type TurnEnd, type TurnRequest } from '@morrowbot/contracts';
import { createTurnApprovals, type TurnApprovals } from './approvals.ts';
import type { CommandRunner } from './command.ts';
import { createGroupLink, type GroupLink } from './host-link.ts';
import type { PluginDefinition, ProviderPlugin } from './plugin.ts';
import { createRuntime, type PluginFactory, type RuntimeOptions } from './runtime.ts';

/** How a served plugin's messages reach the host: a worker's IPC channel, or a channel inside the host. */
export interface PluginTransport {
  /** Sends one message; `done` runs once it has been handed over. */
  send(message: PluginMessage, done?: () => void): void;
  /** The plugin has shut down: end the process (a worker) or close the channel (in the host). */
  exit(): void;
}

export interface ServedPlugin {
  /** One message from the host, not yet checked: malformed ones are logged and ignored. */
  receive(raw: unknown): void;
  /**
   * The host ended this plugin at once. Every command guard's owner pipe closes, so each sweeps its
   * group as after a worker's SIGKILL; running turns are aborted and nothing reaches the host again.
   */
  abandon(): void;
}

interface RunningTurn {
  readonly controller: AbortController;
  readonly approvals: TurnApprovals;
}

interface Served {
  readonly plugin: PluginDefinition;
  readonly send: (message: PluginMessage, done?: () => void) => void;
  readonly exit: () => void;
  readonly turns: Map<string, RunningTurn>;
  readonly commands: CommandRunner;
  readonly link: GroupLink;
}

/** Serves one plugin (wire protocol v1) over `transport`, with its own runtime and commands. */
export function servePlugin(factory: PluginFactory, options: RuntimeOptions & { readonly transport: PluginTransport }): ServedPlugin {
  let abandoned = false;
  const send = (message: PluginMessage, done?: () => void): void => {
    if (!abandoned) options.transport.send(message, done);
  };
  const link = createGroupLink(send);
  const { runtime, commands } = createRuntime(options, link);
  const exit = (): void => {
    options.transport.exit();
  };
  let plugin: PluginDefinition;
  try {
    plugin = factory(runtime);
  } catch (error) {
    commands.abandon();
    throw error;
  }
  const served: Served = { plugin, send, exit, turns: new Map(), commands, link };
  return {
    receive: (raw) => {
      if (abandoned) return;
      const parsed = HostMessage.safeParse(raw);
      if (!parsed.success) {
        console.error(`MorrowBot plugin: ignored a malformed host message: ${parsed.error.message}`);
        return;
      }
      handle(served, parsed.data);
    },
    abandon: () => {
      if (abandoned) return;
      abandoned = true;
      commands.abandon();
      for (const { controller } of served.turns.values()) controller.abort();
    },
  };
}

function handle(served: Served, message: HostMessage): void {
  switch (message.kind) {
    case 'turn':
      runTurn(served, message).catch((error: unknown) => {
        console.error(`MorrowBot plugin: turn ${message.turnId} could not be finished: ${describe(error)}`);
      });
      return;
    case 'cancel':
      served.turns.get(message.turnId)?.controller.abort();
      return;
    case 'approval-reply':
      if (served.turns.get(message.turnId)?.approvals.reply(message.approvalId, message.choiceId) !== true) {
        console.error(`MorrowBot plugin: ignored a stale or unknown approval reply for ${message.approvalId}`);
      }
      return;
    case 'child-group-ack':
      served.link.ack(message.pgid);
      return;
    case 'kill-child-group':
      served.link.kill(message.pgid);
      return;
    case 'init':
    case 'health':
    case 'shutdown':
    case 'provider-info':
    case 'usage':
    case 'route-info':
      answer(served, message).catch((error: unknown) => {
        served.send(failure(message.id, error));
      });
      return;
  }
}

type Request = Extract<HostMessage, { id: number }>;

async function answer(served: Served, message: Request): Promise<void> {
  const { plugin, send } = served;
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
      for (const { controller } of served.turns.values()) controller.abort();
      let reply: PluginMessage = { kind: 'shutdown-result', id };
      try {
        await served.commands.stopAll();
        await plugin.shutdown?.();
      } catch (error) {
        reply = failure(id, error);
      }
      served.commands.abandon();
      send(reply, served.exit);
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

async function runTurn(served: Served, message: Extract<HostMessage, { kind: 'turn' }>): Promise<void> {
  const { turns, send } = served;
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
  controller.signal.addEventListener(
    'abort',
    () => {
      approvals.close();
    },
    { once: true },
  );
  turns.set(turnId, { controller, approvals });
  let end: TurnEnd;
  try {
    end = await provider(served.plugin).turn({ request, signal: controller.signal, emit, ask: (ask) => approvals.ask(ask) });
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
  await served.commands.stopTurn(turnId);
  send({ kind: 'turn-end', turnId, ...end });
}

/** The turn frame, already parsed at the boundary, without its `kind`. */
function requestOf(message: Extract<HostMessage, { kind: 'turn' }>): TurnRequest {
  const { turnId, cwd, mode, access, vendorSettings, expectedAccountKey, expectedRouteKey, selection, session, system, prompt, images } = message;
  return { turnId, cwd, mode, access, vendorSettings, expectedAccountKey, expectedRouteKey, selection, session, system, prompt, images };
}

class UnsupportedError extends Error {}

function failure(id: number, error: unknown): PluginMessage {
  return { kind: 'error', id, code: error instanceof UnsupportedError ? 'unsupported' : 'failed', message: describe(error) };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
