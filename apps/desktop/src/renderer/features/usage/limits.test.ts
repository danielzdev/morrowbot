import type { ProviderInfo, UsageResponse } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { LimitsTab } from './LimitsTab.tsx';
import { REASON_COPY, type LimitReason } from './usage-copy.ts';
import { limitsOf, type UsageProvider } from './usage-view.ts';

const AT = '2026-03-31T10:42:00.000Z';
const NOW = Date.parse('2026-03-31T11:00:00.000Z');
const ZONE = { locale: 'en-US', timeZone: 'UTC' };

const ready = (usage: 'live' | 'none'): ProviderInfo => ({
  kind: 'ready-models-later',
  version: '1.0.0',
  accountKey: 'acct',
  accountLabel: null,
  capabilities: { profiles: [], approvals: true, sessions: true, usage, withheld: [] },
  warning: null,
});

const windows = (stale: boolean): UsageResponse => ({
  usage: {
    kind: 'available',
    observedAt: AT,
    accountKey: 'acct',
    windows: [
      { id: 'five-hour', kind: 'session', scope: { kind: 'account' }, label: '5 hours', usedPercent: 40, resetsAt: '2026-03-31T13:30:00.000Z', windowMinutes: 300 },
      { id: 'weekly-opus', kind: 'weekly', scope: { kind: 'models', modelIds: ['opus'] }, label: 'Weekly · Opus', usedPercent: 92.6, resetsAt: '2026-04-03T00:00:00.000Z', windowMinutes: null },
    ],
  },
  stale,
  persisted: true,
});

const unavailable = (reason: 'unsupported' | 'signed-out' | 'not-yet-observed' | 'api-key-route' | 'probe-failed'): UsageResponse => ({
  usage: { kind: 'unavailable', observedAt: AT, accountKey: 'acct', reason },
  stale: false,
  persisted: false,
});

const provider = (id: string, info: UsageProvider['info'], usage: UsageResponse | null, enabled = true): UsageProvider => ({ id, name: id, enabled, info, usage });

it('turns each host reply into one card, drawing windows only from an available reply', () => {
  const cases: Readonly<Record<string, UsageProvider>> = {
    available: provider('provider-claude', { kind: 'loaded', value: ready('live') }, windows(false)),
    stale: provider('provider-claude', { kind: 'loaded', value: ready('live') }, windows(true)),
    'available, no windows': provider('provider-openai', { kind: 'loaded', value: ready('live') }, { ...windows(false), usage: { kind: 'available', observedAt: AT, accountKey: 'acct', windows: [] } }),
    'api-key-route': provider('provider-openai', { kind: 'loaded', value: ready('live') }, unavailable('api-key-route')),
    'probe-failed': provider('provider-openai', { kind: 'loaded', value: ready('live') }, unavailable('probe-failed')),
    'not-yet-observed': provider('provider-openai', { kind: 'loaded', value: ready('live') }, unavailable('not-yet-observed')),
    'signed-out reply': provider('provider-openai', { kind: 'loaded', value: ready('live') }, unavailable('signed-out')),
    'signed-out, no reply': provider('provider-openai', { kind: 'loaded', value: { kind: 'signed-out', signIn: { kind: 'run-in-terminal', argv: ['codex', 'login'] } } }, null),
    'info loading': provider('provider-openai', { kind: 'loading' }, null),
    'not running': provider('provider-openai', { kind: 'failed', message: 'The plugin is not running.' }, null),
    'turned off': provider('provider-openai', { kind: 'failed', message: 'The plugin is not running.' }, null, false),
    'usage none': provider('community-engine', { kind: 'loaded', value: ready('none') }, windows(false)),
    antigravity: provider('provider-antigravity', { kind: 'loaded', value: ready('none') }, unavailable('unsupported')),
    'antigravity, even with windows': provider('provider-antigravity', { kind: 'loaded', value: ready('live') }, windows(false)),
  };
  const shown = Object.fromEntries(
    Object.entries(cases).map(([name, each]) => {
      const card = limitsOf(each);
      switch (card.kind) {
        case 'checking':
          return [name, 'checking'];
        case 'reason':
          return [name, `reason ${card.reason}`];
        case 'windows':
          return [name, `windows ${card.windows.map((window) => `${window.id}=${String(window.usedPercent)}`).join(',')}${card.stale ? ' stale' : ''}`];
      }
    }),
  );
  expect(shown).toMatchInlineSnapshot(`
    {
      "antigravity": "reason unsupported",
      "antigravity, even with windows": "reason unsupported",
      "api-key-route": "reason api-key-route",
      "available": "windows five-hour=40,weekly-opus=92.6",
      "available, no windows": "reason not-yet-observed",
      "info loading": "checking",
      "not running": "reason no-reply",
      "not-yet-observed": "reason not-yet-observed",
      "probe-failed": "reason probe-failed",
      "signed-out reply": "reason signed-out",
      "signed-out, no reply": "reason signed-out",
      "stale": "windows five-hour=40,weekly-opus=92.6 stale",
      "turned off": "reason turned-off",
      "usage none": "reason unsupported",
    }
  `);
});

it('draws no bar, meter or percentage for Antigravity, even when a reply carries windows', () => {
  const html = renderToString(
    h(LimitsTab, {
      providers: [provider('provider-antigravity', { kind: 'loaded', value: ready('live') }, windows(false))],
      refreshing: new Set<string>(),
      onRetry: () => undefined,
      now: NOW,
      zone: ZONE,
    }),
  );
  expect({ meter: html.includes('role="meter"'), bar: html.includes('limit-bar'), percent: html.includes('%'), text: html.replaceAll(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ').trim() }).toMatchInlineSnapshot(`
    {
      "bar": false,
      "meter": false,
      "percent": false,
      "text": "provider-antigravity Quota unavailable: this provider doesn't report usage limits.",
    }
  `);
});

it('shows windows with % left, a reset chip and the as-of line, marked when stale', () => {
  const text = (stale: boolean): string =>
    renderToString(h(LimitsTab, { providers: [provider('provider-claude', { kind: 'loaded', value: ready('live') }, windows(stale))], refreshing: new Set<string>(), onRetry: () => undefined, now: NOW, zone: ZONE }))
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();
  expect({ fresh: text(false), stale: text(true) }).toMatchInlineSnapshot(`
    {
      "fresh": "provider-claude as of 10:42 AM 5 hours 60% left Resets in 2h 30m Weekly · Opus 7% left opus Resets Apr 3",
      "stale": "provider-claude as of 10:42 AM · may be out of date 5 hours 60% left Resets in 2h 30m Weekly · Opus 7% left opus Resets Apr 3",
    }
  `);
});

it('gives every unavailable reason its own copy, with Try again only where retrying can help', () => {
  const reasons: readonly LimitReason[] = ['unsupported', 'api-key-route', 'signed-out', 'not-yet-observed', 'probe-failed', 'turned-off', 'no-reply'];
  const rendered = reasons.map((reason) => {
    const info: UsageProvider['info'] = reason === 'no-reply' || reason === 'turned-off' ? { kind: 'failed', message: 'not running' } : { kind: 'loaded', value: ready('live') };
    const usage = reason === 'no-reply' || reason === 'turned-off' ? null : unavailable(reason);
    const html = renderToString(h(LimitsTab, { providers: [provider('provider-openai', info, usage, reason !== 'turned-off')], refreshing: new Set<string>(), onRetry: () => undefined, now: NOW, zone: ZONE }));
    return { reason, copy: html.includes(REASON_COPY[reason]), retry: html.includes('Try again'), bar: html.includes('role="meter"') || html.includes('%') };
  });
  expect(rendered).toMatchInlineSnapshot(`
    [
      {
        "bar": false,
        "copy": true,
        "reason": "unsupported",
        "retry": false,
      },
      {
        "bar": false,
        "copy": true,
        "reason": "api-key-route",
        "retry": false,
      },
      {
        "bar": false,
        "copy": true,
        "reason": "signed-out",
        "retry": false,
      },
      {
        "bar": false,
        "copy": true,
        "reason": "not-yet-observed",
        "retry": false,
      },
      {
        "bar": false,
        "copy": true,
        "reason": "probe-failed",
        "retry": true,
      },
      {
        "bar": false,
        "copy": true,
        "reason": "turned-off",
        "retry": false,
      },
      {
        "bar": false,
        "copy": true,
        "reason": "no-reply",
        "retry": true,
      },
    ]
  `);
});
