import { z, type UsageWindow } from '@morrowbot/plugin-sdk';

/** What one `rate_limit_event` says: plan usage per window, and the window that refused the turn, if any. */
export interface RateLimit {
  readonly windows: readonly UsageWindow[];
  readonly rejected: { readonly windowId: string | null; readonly resetsAt: string | null } | null;
}

/** The windows Ori Bot shows. Claude Code also reports model-scoped and overage buckets; those are left out. */
const WINDOWS: Readonly<Record<string, Pick<UsageWindow, 'kind' | 'label' | 'windowMinutes'>>> = {
  five_hour: { kind: 'session', label: 'Session', windowMinutes: 5 * 60 },
  seven_day: { kind: 'weekly', label: 'Weekly', windowMinutes: 7 * 24 * 60 },
};

const Utilization = z.number().nullish();
const EpochSeconds = z.number().nullish();

const UnifiedWindow = z.looseObject({ utilization: Utilization, resetsAt: EpochSeconds });

const RateLimitLine = z.looseObject({
  rate_limit_info: z.looseObject({
    status: z.string().nullish(),
    rateLimitType: z.string().nullish(),
    resetsAt: EpochSeconds,
    overageStatus: z.string().nullish(),
    isUsingOverage: z.boolean().nullish(),
    unifiedWindows: z.record(z.string(), z.unknown()).nullish(),
  }),
});

/** Reads a `rate_limit_event` line (utilization 0–1 becomes 0–100). `null` when its shape is not one Claude Code 2.1.332 sends. */
export function parseRateLimit(json: unknown): RateLimit | null {
  const parsed = RateLimitLine.safeParse(json);
  if (!parsed.success) return null;
  const info = parsed.data.rate_limit_info;
  const byId = new Map<string, UsageWindow>();
  const type = info.rateLimitType ?? null;
  for (const [id, raw] of Object.entries(info.unifiedWindows ?? {})) {
    const unified = UnifiedWindow.safeParse(raw);
    if (unified.success) addWindow(byId, id, unified.data.utilization, unified.data.resetsAt);
  }
  const overage = info.isUsingOverage === true || info.overageStatus === 'allowed' || info.overageStatus === 'allowed_warning';
  const rejected =
    info.status === 'rejected' && !overage
      ? { windowId: type !== null && Object.hasOwn(WINDOWS, type) ? type : null, resetsAt: isoFromEpochSeconds(info.resetsAt) }
      : null;
  return { windows: [...byId.values()], rejected };
}

function addWindow(byId: Map<string, UsageWindow>, id: string, utilization: number | null | undefined, resetsAt: number | null | undefined): void {
  const known = Object.hasOwn(WINDOWS, id) ? WINDOWS[id] : undefined;
  if (known === undefined || typeof utilization !== 'number' || !Number.isFinite(utilization)) return;
  byId.set(id, {
    id,
    ...known,
    scope: { kind: 'account' },
    usedPercent: Math.min(100, Math.max(0, Math.round(utilization * 10_000) / 100)),
    resetsAt: isoFromEpochSeconds(resetsAt),
  });
}

function isoFromEpochSeconds(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const ms = seconds * 1000;
  return ms < 8.64e15 ? new Date(ms).toISOString() : null;
}
