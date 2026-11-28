import { z } from 'zod';
import { REPLY_FILE_SCHEME, type FileActionResult, type MorrowbotBridge } from '../../bridge.ts';
import type { ReplyFiles } from './ReplyAttachments.tsx';

const FileAction = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('opened') }),
  z.strictObject({ kind: z.literal('saved') }),
  z.strictObject({ kind: z.literal('cancelled') }),
  z.strictObject({ kind: z.literal('failed'), reason: z.string() }),
]);

/** The window's reply attachments: loaded from main's `orikami-file:` scheme, opened or saved through main. */
export function replyFiles(bridge: Pick<MorrowbotBridge, 'fileAction'>): ReplyFiles {
  return {
    url: (id) => `${REPLY_FILE_SCHEME}://reply/${encodeURIComponent(id)}`,
    act: async (action, { id, name }): Promise<FileActionResult> => {
      const parsed = FileAction.safeParse(await bridge.fileAction({ action, id, name }));
      return parsed.success ? parsed.data : { kind: 'failed', reason: "Ori Kami couldn't get this file." };
    },
  };
}
