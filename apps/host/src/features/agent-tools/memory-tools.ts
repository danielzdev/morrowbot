import { CreateMemoryRequest, EntityId, MAX_MEMORY_QUERY, MemoryInclusion, type Memory } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ToolPorts } from './ports.ts';
import { done, refused, tool, type Tool } from './tool.ts';

/** The most memories one search gives back. */
const MAX_LIMIT = 50;

const shown = ({ id, inclusion, text, updatedAt }: Memory) => ({ id, inclusion, text, updatedAt });

export function memoryTools({ memories }: ToolPorts): Tool[] {
  return [
    tool({
      name: 'search_memories',
      description: 'Searches your own memories (notes you keep across chats) by keywords, best match first. Essential memories are already in your prompt.',
      input: z.strictObject({
        query: z.string().trim().min(1).max(MAX_MEMORY_QUERY).describe('Keywords to look for.'),
        limit: z.int().min(1).max(MAX_LIMIT).default(10).describe('The most memories to return.'),
      }),
      run: (grant, { query, limit }) => {
        const found = memories.list(grant.agentId, query);
        return found === undefined ? refused('Agent not found') : done({ memories: found.slice(0, limit).map(shown) });
      },
    }),
    tool({
      name: 'remember',
      description:
        'Saves a memory you keep across chats and restarts, or with memoryId changes one of yours. "essential" memories go with every one of your turns; "searchable" ones (the default for a new memory) only come up in search_memories. The user sees and can edit them in Agent Settings.',
      input: z.strictObject({
        text: CreateMemoryRequest.shape.text.describe('What to remember, as a short note.'),
        inclusion: MemoryInclusion.optional().describe('"essential" or "searchable". Left out: "searchable" for a new memory, unchanged for an update.'),
        memoryId: EntityId.optional().describe('The id of your memory to change instead of saving a new one.'),
      }),
      run: (grant, { text, inclusion, memoryId }) => {
        if (memoryId === undefined) {
          const created = memories.create(grant.agentId, { text, inclusion: inclusion ?? 'searchable' });
          return created === undefined ? refused('Agent not found') : done({ memory: shown(created) });
        }
        const updated = memories.update(grant.agentId, memoryId, inclusion === undefined ? { text } : { text, inclusion });
        return updated === undefined ? refused(`You have no memory ${memoryId}`) : done({ memory: shown(updated) });
      },
    }),
    tool({
      name: 'forget_memory',
      description: 'Deletes one of your memories for good.',
      input: z.strictObject({ memoryId: EntityId.describe('The id of your memory to delete.') }),
      run: (grant, { memoryId }) => (memories.delete(grant.agentId, memoryId) ? done({ forgotten: memoryId }) : refused(`You have no memory ${memoryId}`)),
    }),
  ];
}
