import { z } from 'zod';
import type { MorrowbotBridge, UpdateStatus as UpdateStatusValue } from '../bridge.ts';
import { Store } from './store.ts';

/** `bridge.updateStatus()`, `checkForUpdates()` and `onUpdateStatus` values, parsed at the IPC boundary. */
export const UpdateStatus: z.ZodType<UpdateStatusValue> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unsupported') }),
  z.strictObject({ kind: z.literal('idle') }),
  z.strictObject({ kind: z.literal('checking') }),
  z.strictObject({ kind: z.literal('up-to-date') }),
  z.strictObject({ kind: z.literal('downloading'), version: z.string().max(100), percent: z.number().min(0).max(100) }),
  z.strictObject({ kind: z.literal('ready'), version: z.string().max(100) }),
  z.strictObject({ kind: z.literal('failed') }),
]);

export type UpdatesBridge = Pick<MorrowbotBridge, 'updateStatus' | 'onUpdateStatus' | 'checkForUpdates' | 'restartToUpdate'>;

export interface UpdatesModel {
  readonly status: Store<UpdateStatusValue>;
  readonly check: () => void;
  readonly restart: () => void;
  readonly close: () => void;
}

/** Owns the update status main reports; a reply that does not parse leaves it as it was. */
export function createUpdates(bridge: UpdatesBridge): UpdatesModel {
  const status = new Store<UpdateStatusValue>({ kind: 'idle' });
  const take = (reply: unknown): void => {
    const parsed = UpdateStatus.safeParse(reply);
    if (parsed.success) status.set(parsed.data);
  };
  const stop = bridge.onUpdateStatus(take);
  void bridge.updateStatus().then(take, () => undefined);
  return {
    status,
    check: () => {
      void bridge.checkForUpdates().then(take, () => {
        status.set({ kind: 'failed' });
      });
    },
    restart: () => void bridge.restartToUpdate(),
    close: stop,
  };
}

/** The one line Settings › About shows for a status. */
export function updateNote(status: UpdateStatusValue): string {
  switch (status.kind) {
    case 'unsupported':
      return 'Only in the installed app';
    case 'idle':
      return 'Checks automatically in the background';
    case 'checking':
      return 'Checking…';
    case 'up-to-date':
      return 'Ori Kami is up to date';
    case 'downloading':
      return `Downloading ${status.version}… ${String(status.percent)}%`;
    case 'ready':
      return `${status.version} is ready to install`;
    case 'failed':
      return "Couldn't check for updates. Try again later.";
  }
}
