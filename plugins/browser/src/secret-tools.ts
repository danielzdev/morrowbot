import { BrowserTabId, ElementRef, TakeoverReason, type BrowserEvent } from '@morrowbot/contracts';
import { z } from '@morrowbot/plugin-sdk';
import type { Bridge } from './bridge.ts';
import type { BrowserLink } from './browser-link.ts';
import { SecretRequest } from './secrets.ts';
import { BrowserChoice, COMMAND_TIMEOUT_MS, defineTool, isLink, pickBrowser, present, type BrowserTool, type ToolOutput } from './tool.ts';

const TAKEOVER_LIMIT_MS = 15 * 60_000;

/** The tools that hand sensitive steps to the vault or to the person. */
export function secretTools({ bridge, takeoverLimitMs = TAKEOVER_LIMIT_MS }: { readonly bridge: Bridge; readonly takeoverLimitMs?: number }): readonly BrowserTool[] {
  return [
    defineTool({
      name: 'browser_fill_secret',
      description:
        "Fills a vault login's username, password or one-time code into a field. Only on the login's own website; the value goes from the vault to the page and is never shown to you.",
      input: z.strictObject({ browser: BrowserChoice, tabId: BrowserTabId, ref: ElementRef, secret: SecretRequest }),
      run: async ({ browser, tabId, ref, secret }, { secrets }) => {
        const link = pickBrowser(bridge, browser);
        if (!isLink(link)) return link;
        const origin = await originOf(link, tabId);
        if (origin.kind === 'error') return origin;
        const resolved = await secrets({ ...secret, origin: origin.text });
        if (resolved.kind === 'refused') return { kind: 'error', text: resolved.reason };
        const result = await link.run({ kind: 'fill-secret', tabId, ref, field: secret.field, origin: origin.text, value: resolved.value }, COMMAND_TIMEOUT_MS);
        const output = present(result, `Filled the ${secret.field} of vault login ${secret.vaultId} into ${ref}.`);
        return output.kind === 'image' ? output : { kind: output.kind, text: output.text.replaceAll(resolved.value, '•••') };
      },
    }),
    defineTool({
      name: 'browser_request_takeover',
      description:
        'Hands the tab to the person for a step only they should do (a login, 2FA, payment or CAPTCHA) and waits until they say they are done. Take a new snapshot after.',
      input: z.strictObject({
        browser: BrowserChoice,
        tabId: BrowserTabId,
        reason: TakeoverReason,
        message: z.string().min(1).max(500).describe('What you need the person to do, shown on the page'),
      }),
      run: async ({ browser, tabId, reason, message }, { signal }) => {
        const link = pickBrowser(bridge, browser);
        if (!isLink(link)) return link;
        return takeover(link, { tabId, reason, message }, signal, takeoverLimitMs);
      },
    }),
  ];
}

async function originOf(link: BrowserLink, tabId: number): Promise<{ readonly kind: 'text' | 'error'; readonly text: string }> {
  const listed = await link.run({ kind: 'list-tabs' }, COMMAND_TIMEOUT_MS);
  if (listed.kind === 'error') return { kind: 'error', text: listed.message };
  if (listed.value.kind !== 'tabs') return { kind: 'error', text: 'The browser answered list-tabs with something else.' };
  const tab = listed.value.tabs.find((candidate) => candidate.tabId === tabId);
  if (tab === undefined) return { kind: 'error', text: `No tab ${String(tabId)}.` };
  const url = URL.parse(tab.url);
  if (url === null || !['http:', 'https:'].includes(url.protocol)) return { kind: 'error', text: 'Secrets are filled only on http and https pages.' };
  return { kind: 'text', text: url.origin };
}

type Ended = Extract<BrowserEvent, { kind: 'takeover-ended' }>['outcome'] | 'aborted' | 'timed-out' | 'disconnected';

async function takeover(
  link: BrowserLink,
  request: { readonly tabId: number; readonly reason: TakeoverReason; readonly message: string },
  signal: AbortSignal,
  limitMs: number,
): Promise<ToolOutput> {
  const takeoverId = crypto.randomUUID();
  const ended = Promise.withResolvers<Ended>();
  const unsubscribe = link.onEvent((event) => {
    if (event.kind === 'takeover-ended' && event.takeoverId === takeoverId) ended.resolve(event.outcome);
  });
  const onAbort = (): void => {
    ended.resolve('aborted');
  };
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    ended.resolve('timed-out');
  }, limitMs);
  void link.gone.then(() => {
    ended.resolve('disconnected');
  });
  try {
    const started = await link.run({ kind: 'start-takeover', ...request, takeoverId }, COMMAND_TIMEOUT_MS);
    if (started.kind === 'error') return present(started, '');
    const outcome = await ended.promise;
    switch (outcome) {
      case 'done':
        return { kind: 'text', text: 'The person says they are done. Take a new snapshot before you carry on.' };
      case 'cancelled':
        return { kind: 'error', text: 'The person declined the takeover. Ask them what to do instead.' };
      case 'tab-closed':
        return { kind: 'error', text: 'The person closed the tab during the takeover.' };
      case 'disconnected':
        return { kind: 'error', text: 'The browser disconnected during the takeover.' };
      case 'aborted':
      case 'timed-out':
        await link.run({ kind: 'end-takeover', tabId: request.tabId, takeoverId }, COMMAND_TIMEOUT_MS);
        return { kind: 'error', text: outcome === 'aborted' ? 'The takeover was stopped.' : `The person did not finish within ${String(Math.round(limitMs / 60_000))} minutes.` };
    }
  } finally {
    unsubscribe();
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
