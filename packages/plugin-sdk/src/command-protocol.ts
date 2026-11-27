import { z } from 'zod';

/** The first file descriptor a command sees its extra input files on. */
export const FIRST_FILE_FD = 4;

/** What the command guard reports about the command it runs. */
export const GuardMessage = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exit'), code: z.number().int().nullable(), signal: z.string().nullable() }),
  z.strictObject({ kind: z.literal('spawn-error'), code: z.string(), message: z.string() }),
]);
export type GuardMessage = z.infer<typeof GuardMessage>;
