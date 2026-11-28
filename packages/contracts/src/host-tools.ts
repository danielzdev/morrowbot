import { z } from 'zod';

/** The name a provider gives the host's MCP server; its tools show up to the model under it (`mcp__morrowbot__remember`). */
export const HOST_TOOLS_SERVER = 'morrowbot';

/**
 * MorrowBot's own tools for one turn. `mcp` is a Streamable HTTP MCP server on loopback; every call
 * carries `authorization: Bearer <token>`, and the token acts only as the turn's agent, in the turn's
 * chat, until the turn ends. `none` when the host offers no tools (a provider plugin may ignore them).
 */
export const HostTools = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('mcp'), url: z.url({ protocol: /^http$/ }), token: z.string().min(32).max(256) }),
]);
export type HostTools = z.infer<typeof HostTools>;

