import type { Message } from '@morrowbot/contracts';

/**
 * A chat as Markdown for the clipboard (spec §3.3). The user's own words are kept as written; the
 * agent's replies pass through `redact` (spec §9.1).
 */
export function chatMarkdown(title: string, agentName: string, messages: readonly Message[], redact: (text: string) => string): string {
  const parts = [`# ${title}`];
  for (const message of messages) {
    if (message.kind === 'user') parts.push(`**You:**\n\n${message.text}`);
    else if (message.text !== '') parts.push(`**${agentName}:**\n\n${redact(message.text)}`);
  }
  return `${parts.join('\n\n')}\n`;
}
