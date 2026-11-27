import type { ConnectionSlot } from '../../lib/workspace.ts';

/** Placeholder until #72 lands the host transport; it provides nothing yet. */
export const connection: ConnectionSlot = {
  Provider: ({ children }) => children,
};
