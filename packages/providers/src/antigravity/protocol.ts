import { acp, z } from '@morrowbot/plugin-sdk';

/**
 * What `agy acp` 1.5.18 adds to the shared ACP shapes, checked against its recorded transcripts
 * (`fixtures/1.5.18/`): the plan of the signed-in account in a session's `_meta`.
 */

/** A name agy may leave blank (`""`): null then, as the contract allows no empty names. */
const Named = z.string().transform((name) => (name.trim() === '' ? null : name));

const SessionMeta = z
  .looseObject({ antigravity: z.looseObject({ tier: z.looseObject({ name: Named }).nullish() }).nullish() })
  .nullish();

export const SessionNewResponse = acp.SessionNewResponse.extend({ _meta: SessionMeta });
export type SessionNewResponse = z.infer<typeof SessionNewResponse>;

export const SessionLoadResponse = acp.SessionLoadResponse.extend({ _meta: SessionMeta });
