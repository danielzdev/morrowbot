import type { ConnectionSlot } from '../../lib/workspace.ts';
import { ConnectionProvider } from './ConnectionProvider.tsx';

/** Provides `useHostConnection()` to the whole app. */
export const connection: ConnectionSlot = { Provider: ConnectionProvider };
