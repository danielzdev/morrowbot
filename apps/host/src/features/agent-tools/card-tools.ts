import { CardProposal } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ReplyAnswer, ToolPorts } from './ports.ts';
import { done, refused, tool, type Tool, type ToolResult } from './tool.ts';

/** Cards in the chat (`card.propose` in the design notes; MCP tool names cannot hold a dot for every provider). */
export function cardTools({ cards }: ToolPorts): Tool[] {
  return [
    tool({
      name: 'propose_card',
      description: [
        'Puts a card in the chat under your reply. Kinds:',
        '"custom": your own card made of blocks (header, text, kv, list, badges, divider, and at most one choices block). It shows as text only, in a frame with your name: no links, images or markup. fallbackText says the same in plain words. When the user clicks a choice, its label comes to you as their next message.',
        '"plugin": offers a plugin from the Marketplace (find it with search_marketplace first). MorrowBot draws the card from the plugin’s own manifest, with Install, Open and Cancel; only the user’s click installs it.',
        '"setting": a one-click switch for a safe setting. "agent-emoji-replies" lets you answer with only an emoji, or no message, when a reply would be filler.',
        'At most 3 cards per reply. Write a short reply as well; do not repeat the card’s content.',
      ].join(' '),
      input: z.strictObject({ card: CardProposal }),
      run: async (grant, { card }) => result(await cards.propose(grant, card)),
    }),
    tool({
      name: 'search_marketplace',
      description:
        'Searches the MorrowBot Marketplace for plugins, by words in their id, name or description (empty for all). Each result says what it does, the permissions it asks for, and whether it is installed. Offer one to the user with propose_card.',
      input: z.strictObject({ query: z.string().trim().max(100).default('').describe('Words to look for, or empty for every plugin.') }),
      run: async (_grant, { query }) => result(await cards.searchMarketplace(query)),
    }),
  ];
}

function result(answer: ReplyAnswer): ToolResult {
  switch (answer.kind) {
    case 'done':
      return done(answer.value);
    case 'refused':
      return refused(answer.reason);
  }
}
