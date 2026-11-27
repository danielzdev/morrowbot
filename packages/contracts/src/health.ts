import { z } from 'zod';

export const HealthResponse = z.strictObject({
  status: z.literal('ok'),
  version: z.string().min(1),
  uptimeMs: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
