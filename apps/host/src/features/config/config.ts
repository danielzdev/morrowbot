import { z } from 'zod';

const DEFAULT_PORT = 47_800;

const PortString = z
  .string()
  .regex(/^\d+$/, 'Expected an integer port')
  .transform((value) => Number(value))
  .pipe(z.number().int().min(0).max(65_535));

const HostEnv = z.object({
  MORROWBOT_HOST_PORT: PortString.optional(),
});

export interface HostConfig {
  readonly hostname: '127.0.0.1';
  readonly port: number;
}

export type HostConfigResult =
  | { readonly kind: 'ok'; readonly config: HostConfig }
  | { readonly kind: 'invalid'; readonly problems: readonly string[] };

export function parseHostConfig(env: NodeJS.ProcessEnv): HostConfigResult {
  const parsed = HostEnv.safeParse(env);
  if (!parsed.success) {
    return {
      kind: 'invalid',
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  return { kind: 'ok', config: { hostname: '127.0.0.1', port: parsed.data.MORROWBOT_HOST_PORT ?? DEFAULT_PORT } };
}
