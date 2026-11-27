import type {
  AgentTools,
  AssistantMessage,
  ChatEvent,
  ChatProvider,
  CreateThreadRequest,
  Message,
  StopGenerationResponse,
  Thread,
  UserMessage,
} from '@morrowbot/contracts';
import { assistantMessage, generate } from './generation.ts';
import type { ChatListener, ChatServiceOptions } from './ports.ts';

export type SendResult =
  | { readonly kind: 'started'; readonly generationId: string; readonly userMessage: UserMessage }
  | { readonly kind: 'thread_not_found' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'no_provider'; readonly reason: string };

export interface ChatService {
  listThreads(agentId: string): Thread[] | undefined;
  createThread(agentId: string, request: CreateThreadRequest): Thread | undefined;
  getThread(id: string): Thread | undefined;
  renameThread(id: string, title: string): Thread | undefined;
  deleteThread(id: string): Promise<boolean>;
  listMessages(threadId: string): Message[] | undefined;
  send(threadId: string, text: string): SendResult;
  /** Stops the thread's active generation and resolves once its partial reply is saved. */
  stop(threadId: string): Promise<StopGenerationResponse>;
  /** Stops every active generation in the agent's threads (before the agent is deleted). */
  stopAgent(agentId: string): Promise<void>;
  subscribe(listener: ChatListener): () => void;
  close(): Promise<void>;
}

interface StartRun {
  readonly provider: ChatProvider;
  readonly model: string;
}

interface ActiveGeneration {
  readonly id: string;
  readonly agentId: string;
  readonly controller: AbortController;
  readonly done: Promise<AssistantMessage>;
}

export function createChatService(options: ChatServiceOptions): ChatService {
  const { threads, messages, agents } = options;
  const listeners = new Set<ChatListener>();
  const active = new Map<string, ActiveGeneration>();

  const publish = (event: ChatEvent): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        options.report(error);
      }
    }
  };

  const touch = (thread: Thread): void => {
    threads.update({ ...thread, updatedAt: options.now() });
  };

  const stop = async (threadId: string): Promise<StopGenerationResponse> => {
    const generation = active.get(threadId);
    if (generation === undefined) return { kind: 'idle' };
    generation.controller.abort();
    return { kind: 'stopped', message: await generation.done };
  };

  function start(thread: Thread, userMessage: UserMessage, tools: AgentTools, run: StartRun): string {
    const generationId = options.newId();
    const controller = new AbortController();
    const ref = { threadId: thread.id, generationId };
    const watchedTools: AgentTools = {
      run: async (call, signal) => {
        const result = await tools.run(
          call,
          signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]),
        );
        publish({ kind: 'generation.tool', ...ref, call, result });
        return result;
      },
    };
    const done = generate({
      ...ref,
      provider: run.provider,
      model: run.model,
      history: messages.listByThread(thread.id),
      loadInstructions: async () => (await agents.readInstructions(thread.agentId)) ?? '',
      tools: watchedTools,
      signal: controller.signal,
      publish,
    }).then((result) => {
      const message = assistantMessage(options.newId(), thread.id, result, options.now());
      try {
        messages.insert(message);
        touch(thread);
      } catch (error) {
        options.report(error);
      }
      active.delete(thread.id);
      publish({ kind: 'generation.finished', ...ref, message });
      return message;
    });
    active.set(thread.id, { id: generationId, agentId: thread.agentId, controller, done });
    publish({ kind: 'generation.started', ...ref, userMessage });
    return generationId;
  }

  return {
    listThreads: (agentId) => (agents.get(agentId) === undefined ? undefined : threads.listByAgent(agentId)),
    createThread: (agentId, request) => {
      if (agents.get(agentId) === undefined) return undefined;
      const at = options.now();
      const thread: Thread = { id: options.newId(), agentId, title: request.title, createdAt: at, updatedAt: at };
      threads.insert(thread);
      return thread;
    },
    getThread: (id) => threads.get(id),
    renameThread: (id, title) => {
      const current = threads.get(id);
      if (current === undefined) return undefined;
      const next: Thread = { ...current, title, updatedAt: options.now() };
      threads.update(next);
      return next;
    },
    deleteThread: async (id) => {
      await stop(id);
      return threads.delete(id);
    },
    listMessages: (threadId) => (threads.get(threadId) === undefined ? undefined : messages.listByThread(threadId)),
    send: (threadId, text) => {
      const thread = threads.get(threadId);
      if (thread === undefined) return { kind: 'thread_not_found' };
      if (active.has(threadId)) return { kind: 'busy' };
      const agent = agents.get(thread.agentId);
      if (agent === undefined) return { kind: 'thread_not_found' };
      switch (agent.provider.kind) {
        case 'unbound':
          return { kind: 'no_provider', reason: 'This agent has no provider. Choose a provider and model first.' };
        case 'bound': {
          const provider = options.providers.provider(agent.provider.pluginId);
          if (provider === undefined) {
            return { kind: 'no_provider', reason: `Provider plugin ${agent.provider.pluginId} is not available.` };
          }
          const userMessage: UserMessage = {
            kind: 'user',
            id: options.newId(),
            threadId,
            text,
            createdAt: options.now(),
          };
          messages.insert(userMessage);
          touch(thread);
          const generationId = start(thread, userMessage, options.toolsFor(agent.workspace.dir), {
            provider,
            model: agent.provider.model,
          });
          return { kind: 'started', generationId, userMessage };
        }
      }
    },
    stop,
    stopAgent: async (agentId) => {
      const threadIds = [...active].filter(([, generation]) => generation.agentId === agentId).map(([id]) => id);
      await Promise.all(threadIds.map((id) => stop(id)));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: async () => {
      await Promise.all([...active.keys()].map((id) => stop(id)));
    },
  };
}
