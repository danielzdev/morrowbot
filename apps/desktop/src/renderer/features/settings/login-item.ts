import { z } from 'zod';
import type { LoginItem as LoginItemValue } from '../../bridge.ts';

/** `bridge.loginItem()` and `bridge.setOpenAtLogin()` replies, parsed at the IPC boundary. */
export const LoginItem: z.ZodType<LoginItemValue> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unsupported') }),
  z.strictObject({ kind: z.literal('supported'), openAtLogin: z.boolean() }),
]);

export type LoginItemState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | LoginItemValue;

/** Reads (or, with `open`, sets) open-at-login; a bad or failed reply is `failed`. */
export async function loadLoginItem(request: () => Promise<unknown>): Promise<LoginItemState> {
  try {
    const parsed = LoginItem.safeParse(await request());
    return parsed.success ? parsed.data : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
