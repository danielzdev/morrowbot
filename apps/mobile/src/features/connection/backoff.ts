/** Reconnect waits grow from half a second to at most 30 seconds. */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 30_000;

/**
 * How long to wait before reconnect attempt `attempt` (1 = the first retry): exponential with
 * jitter between half and all of the step, so many phones do not reconnect in lockstep.
 */
export function reconnectDelay(attempt: number, random: () => number): number {
  const step = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(step / 2 + (step / 2) * random());
}
