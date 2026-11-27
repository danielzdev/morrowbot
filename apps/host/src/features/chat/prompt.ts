import type { Attachment, AttachmentContent, TurnImage } from '@morrowbot/contracts';

/** What the agent knows before the user's message: its skills index and its essential memories. */
export interface Prelude {
  readonly skills: readonly { readonly name: string; readonly description: string; readonly file: string }[];
  readonly memories: readonly string[];
}

/** A sent attachment with the content read from the data folder. */
export interface ReadAttachment {
  readonly attachment: Attachment;
  readonly content: AttachmentContent;
}

export interface TurnInput {
  readonly prompt: string;
  readonly images: TurnImage[];
}

/** The prompt a provider gets for one user message, and the images that go with it. */
export function buildTurnInput(prelude: Prelude, text: string, attachments: readonly ReadAttachment[]): TurnInput {
  const parts: string[] = [];
  const context = contextBlock(prelude);
  if (context !== null) parts.push(context);
  const images: TurnImage[] = [];
  for (const { attachment, content } of attachments) {
    switch (content.kind) {
      case 'image':
        images.push({ mimeType: content.mimeType, data: content.data });
        parts.push(`<attached-image name="${attribute(attachment.name)}" />`);
        break;
      case 'text':
        parts.push(`<attached-file name="${attribute(attachment.name)}">\n${content.text}\n</attached-file>`);
        break;
    }
  }
  const message = text.trim();
  parts.push(message === '' ? '(No message: see the attached files.)' : message);
  return { prompt: parts.join('\n\n'), images };
}

function contextBlock(prelude: Prelude): string | null {
  const sections: string[] = [];
  if (prelude.skills.length > 0) {
    const lines = prelude.skills.map((skill) => `- ${skill.name}: ${oneLine(skill.description)} (${skill.file})`);
    sections.push(`<skills>\nSkills you can use. When one fits the task, read its SKILL.md first and follow it.\n${lines.join('\n')}\n</skills>`);
  }
  if (prelude.memories.length > 0) {
    const lines = prelude.memories.map((memory) => `- ${oneLine(memory)}`);
    sections.push(`<memories>\nThings to remember from earlier chats.\n${lines.join('\n')}\n</memories>`);
  }
  return sections.length === 0 ? null : `<morrowbot-context>\n${sections.join('\n')}\n</morrowbot-context>`;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const attribute = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
