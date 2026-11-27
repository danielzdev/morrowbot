import { z } from 'zod';
import { EntityId, Timestamp } from './ids.ts';

/** `essential` memories go with every turn of the agent; `searchable` ones only come up in a search. */
export const MemoryInclusion = z.enum(['essential', 'searchable']);
export type MemoryInclusion = z.infer<typeof MemoryInclusion>;

const MemoryText = z.string().trim().min(1).max(4000);

/** Something an agent keeps across chats and restarts. */
export const Memory = z.strictObject({
  id: EntityId,
  agentId: EntityId,
  inclusion: MemoryInclusion,
  text: MemoryText,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Memory = z.infer<typeof Memory>;

export const MemoryList = z.strictObject({ memories: z.array(Memory) });
export type MemoryList = z.infer<typeof MemoryList>;

export const CreateMemoryRequest = z.strictObject({ text: MemoryText, inclusion: MemoryInclusion.default('searchable') });
export type CreateMemoryRequest = z.infer<typeof CreateMemoryRequest>;

export const UpdateMemoryRequest = z
  .strictObject({ text: MemoryText.optional(), inclusion: MemoryInclusion.optional() })
  .refine((request) => request.text !== undefined || request.inclusion !== undefined, { error: 'Change the text or the inclusion' });
export type UpdateMemoryRequest = z.infer<typeof UpdateMemoryRequest>;

/** The longest search query `GET /api/agents/:id/memories?q=` takes. */
export const MAX_MEMORY_QUERY = 200;
