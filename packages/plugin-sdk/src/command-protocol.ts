import { z } from 'zod';

/** The first file descriptor a command sees its extra input files on. */
export const FIRST_FILE_FD = 4;

/** What the command guard tells the plugin process, over the guard's IPC channel (its owner pipe). */
export const GuardMessage = z.discriminatedUnion('kind', [
  /** The guard leads its own process group and waits for `spawn` before it starts the command. */
  z.strictObject({ kind: z.literal('started'), pgid: z.number().int().positive(), leaderStart: z.string().min(1) }),
  z.strictObject({ kind: z.literal('exit'), code: z.number().int().nullable(), signal: z.string().nullable() }),
  z.strictObject({ kind: z.literal('spawn-error'), code: z.string(), message: z.string() }),
]);
export type GuardMessage = z.infer<typeof GuardMessage>;

/** What the plugin process tells the guard. */
export const OwnerMessage = z.discriminatedUnion('kind', [
  /** The host has registered the group: start the command, with `env` on top of the guard's own. */
  z.strictObject({ kind: z.literal('spawn'), env: z.record(z.string(), z.string()) }),
  /** Stop the group: SIGTERM, then SIGKILL a second later. */
  z.strictObject({ kind: z.literal('kill') }),
]);
export type OwnerMessage = z.infer<typeof OwnerMessage>;
