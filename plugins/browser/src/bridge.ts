import { BROWSER_BRIDGE_SUBPROTOCOL, EXTENSION_ORIGIN } from '@morrowbot/contracts';
import type { PluginRuntime } from '@morrowbot/plugin-sdk';
import { acceptLink, type BrowserLink } from './browser-link.ts';

/** Screenshots of long pages are the largest frames. */
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export interface BridgeOptions {
  readonly serve: PluginRuntime['serveLoopback'];
  readonly port: number;
  readonly pairingToken: string;
  readonly helloTimeoutMs?: number;
}

/** The browsers connected to this plugin. Several may be (Chrome and Brave, say); each gets its own id, kept across reconnects. */
export interface Bridge {
  readonly port: number;
  browsers(): readonly BrowserLink[];
  /** Waits until a browser with `browserId` (or any, when null) is connected. Tests and start-up use it. */
  whenConnected(browserId: string | null, timeoutMs: number): Promise<BrowserLink>;
  close(): Promise<void>;
}

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const links = new Map<string, BrowserLink>();
  const waiters = new Set<(link: BrowserLink) => void>();
  const server = await options.serve({
    port: options.port,
    token: options.pairingToken,
    subprotocol: BROWSER_BRIDGE_SUBPROTOCOL,
    origin: EXTENSION_ORIGIN,
    maxMessageBytes: MAX_FRAME_BYTES,
    onConnection: (socket) => {
      acceptLink(socket, {
        helloTimeoutMs: options.helloTimeoutMs ?? 5000,
        nameFor: (hello) => {
          const base = hello.browser.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || hello.browser.family;
          let count = 1;
          while (links.has(`${base}-${String(count)}`)) count += 1;
          return `${base}-${String(count)}`;
        },
        onReady: (link) => {
          links.set(link.browserId, link);
          for (const wake of waiters) wake(link);
        },
        onGone: (link) => {
          if (links.get(link.browserId) === link) links.delete(link.browserId);
        },
      });
    },
  });
  return {
    port: server.port,
    browsers: () => [...links.values()],
    whenConnected: (browserId, timeoutMs) => {
      const matches = (link: BrowserLink): boolean => browserId === null || link.browserId === browserId;
      const found = [...links.values()].find(matches);
      if (found !== undefined) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(wake);
          reject(new Error(`No browser connected within ${String(timeoutMs)} ms`));
        }, timeoutMs);
        const wake = (link: BrowserLink): void => {
          if (!matches(link)) return;
          clearTimeout(timer);
          waiters.delete(wake);
          resolve(link);
        };
        waiters.add(wake);
      });
    },
    close: () => server.close(),
  };
}
