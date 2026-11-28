import { MAX_REPLY_ATTACHMENTS } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ToolPorts } from './ports.ts';
import { done, refused, tool, type Tool } from './tool.ts';

/** The tool that puts local files under the agent's reply, shown inline in the chat. */
export function attachTools({ replyAttachments }: ToolPorts): Tool[] {
  return [
    tool({
      name: 'attach_files',
      description:
        'Attaches files from your workspace folder to the reply you are writing, so the user sees them under it: images (PNG, JPEG, WebP, GIF) and videos (MP4, WebM) inline, PDFs and other files as cards to open or save. Save the file inside your workspace folder first, then pass its absolute path. Each file is copied when you call this, so attach it after it is finished. Up to 8 files and 100 MB each (200 MB in all) per reply. Mention the files in your reply text; do not paste their contents.',
      input: z.strictObject({
        paths: z.array(z.string().min(1).max(4096)).min(1).max(MAX_REPLY_ATTACHMENTS).describe('Absolute paths of files inside your workspace folder.'),
      }),
      run: async (grant, { paths }, signal) => {
        const answer = await replyAttachments.attach(grant, paths, signal);
        if (answer.attached.length === 0) return refused(answer.refused.map(({ path, reason }) => `${path}: ${reason}`).join('\n'));
        return done({
          attached: answer.attached.map(({ name, kind, mimeType, size }) => ({ name, kind, mimeType, size })),
          refused: answer.refused,
        });
      },
    }),
  ];
}
