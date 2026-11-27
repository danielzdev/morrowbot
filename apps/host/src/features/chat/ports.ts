import type { Agent, AgentTools, ChatEvent, Message, ProviderRegistry, Thread } from '@morrowbot/contracts';

export interface ThreadRecords {
  insert(thread: Thread): void;
  update(thread: Thread): void;
  delete(id: string): boolean;
  get(id: string): Thread | undefined;
  listByAgent(agentId: string): Thread[];
}

export interface MessageRecords {
  insert(message: Message): void;
  listByThread(threadId: string): Message[];
}

export interface AgentDirectory {
  get(id: string): Agent | undefined;
  readInstructions(id: string): Promise<string | undefined>;
}

export interface ChatServiceOptions {
  readonly threads: ThreadRecords;
  readonly messages: MessageRecords;
  readonly agents: AgentDirectory;
  readonly providers: ProviderRegistry;
  readonly toolsFor: (workspaceDir: string) => AgentTools;
  readonly newId: () => string;
  readonly now: () => string;
  /** Called with errors that have no caller to return to, such as a failed write after a generation. */
  readonly report: (error: unknown) => void;
}

export type ChatListener = (event: ChatEvent) => void;
