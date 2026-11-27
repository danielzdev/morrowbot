import type { OpenPluginChannel } from '@morrowbot/contracts';
import { servePlugin, type PluginFactory, type RuntimeEnv, type ServedPlugin } from '@morrowbot/plugin-sdk';

/**
 * Serves a built-in provider inside the host, on the same wire protocol a plugin worker speaks but
 * with no worker process. Messages are copied as JSON and delivered on a later turn of the event
 * loop, as over IPC, so neither side ever runs inside the other's call.
 *
 * `kill` abandons the provider the way SIGKILL ends a worker: every command guard's owner pipe
 * closes, so each sweeps its process group, and nothing more is delivered either way (a message
 * still in flight is dropped, so the exit reason stays the kill). A host message
 * whose handling throws ends the provider the same way, as an uncaught exception ends a worker, and
 * a provider that throws while it is built fails to start, as a worker that dies on load.
 */
export function inHostChannel(factory: PluginFactory, env: RuntimeEnv, platform: NodeJS.Platform): OpenPluginChannel {
  return (events) => {
    let open = true;
    const close = (code: number | null, signal: string | null): void => {
      if (!open) return;
      open = false;
      setImmediate(() => {
        events.exit(code, signal);
      });
    };
    let served: ServedPlugin;
    try {
      served = servePlugin(factory, {
        env,
        platform,
        transport: {
          send: (message, done) => {
            const copy = copyOf(message);
            setImmediate(() => {
              if (!open) return;
              events.message(copy);
              done?.();
            });
          },
          exit: () => {
            close(0, null);
          },
        },
      });
    } catch (error) {
      open = false;
      setImmediate(() => {
        events.error(error instanceof Error ? error : new Error(String(error)), false);
      });
      return { connected: false, send: (_message, done) => {
          setImmediate(done, null);
        },
        kill: () => undefined };
    }
    return {
      get connected() {
        return open;
      },
      send: (message, done) => {
        const copy = copyOf(message);
        setImmediate(() => {
          if (!open) {
            done(null);
            return;
          }
          try {
            served.receive(copy);
          } catch (error) {
            console.error('MorrowBot host: a built-in provider threw while handling a message', error);
            served.abandon();
            close(1, null);
          }
          done(null);
        });
      },
      kill: () => {
        if (!open) return;
        served.abandon();
        close(null, 'SIGKILL');
      },
    };
  };
}

/** What the IPC channel's JSON serialization would deliver: no shared objects between the two sides. */
function copyOf(message: object): unknown {
  return JSON.parse(JSON.stringify(message));
}
