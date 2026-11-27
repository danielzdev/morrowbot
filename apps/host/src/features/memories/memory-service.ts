import type { CreateMemoryRequest, Memory, UpdateMemoryRequest } from '@morrowbot/contracts';

/** Where memories are kept (the storage feature provides one). */
export interface MemoryRecords {
  insert(memory: Memory): void;
  update(memory: Memory): void;
  delete(agentId: string, id: string): boolean;
  get(agentId: string, id: string): Memory | undefined;
  list(agentId: string): Memory[];
  essential(agentId: string): Memory[];
  search(agentId: string, query: string): Memory[];
}

export interface MemoryServiceOptions {
  readonly records: MemoryRecords;
  readonly agentExists: (agentId: string) => boolean;
  readonly newId: () => string;
  readonly now: () => string;
}

/** Each call is undefined for an unknown agent (or memory). */
export interface MemoryService {
  /** All the agent's memories, oldest first, or those matching `query` best first. */
  list(agentId: string, query: string): Memory[] | undefined;
  create(agentId: string, request: CreateMemoryRequest): Memory | undefined;
  update(agentId: string, id: string, request: UpdateMemoryRequest): Memory | undefined;
  delete(agentId: string, id: string): boolean;
  /** The texts that go with every turn of the agent. */
  essential(agentId: string): string[];
}

export function createMemoryService(options: MemoryServiceOptions): MemoryService {
  const { records, agentExists } = options;
  return {
    list: (agentId, query) => {
      if (!agentExists(agentId)) return undefined;
      return query.trim() === '' ? records.list(agentId) : records.search(agentId, query);
    },
    create: (agentId, request) => {
      if (!agentExists(agentId)) return undefined;
      const at = options.now();
      const memory: Memory = { id: options.newId(), agentId, inclusion: request.inclusion, text: request.text, createdAt: at, updatedAt: at };
      records.insert(memory);
      return memory;
    },
    update: (agentId, id, request) => {
      const current = records.get(agentId, id);
      if (current === undefined) return undefined;
      const next: Memory = { ...current, text: request.text ?? current.text, inclusion: request.inclusion ?? current.inclusion, updatedAt: options.now() };
      records.update(next);
      return next;
    },
    delete: (agentId, id) => records.delete(agentId, id),
    essential: (agentId) => records.essential(agentId).map(({ text }) => text),
  };
}
