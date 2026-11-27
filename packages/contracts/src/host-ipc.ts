import { z } from 'zod';

/**
 * What the host process tells the Electron main process that forked it, over Node IPC.
 * The token is the per-launch API credential: it lives only in memory (never in env, argv or on disk).
 */
export const HostLaunchMessage = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ready'), url: z.url(), token: z.string().min(32) }),
  /** Another host holds this data directory's lock. The host exits without touching the database. */
  z.strictObject({ kind: z.literal('already-running') }),
  z.strictObject({ kind: z.literal('failed'), message: z.string() }),
]);
export type HostLaunchMessage = z.infer<typeof HostLaunchMessage>;
