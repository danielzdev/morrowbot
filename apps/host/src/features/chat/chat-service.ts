import type {
  AgentTools,
  AssistantMessage,
  ChatEvent,
  ChatProvider,
  CreateThreadRequest,
  Message,
  StopGenerationResponse,
  Thread,
  ToolResult,
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
  /** Stops the thread's generation, then deletes the thread. No new message can start meanwhile. */
  deleteThread(id: string): Promise<boolean>;
  /** Stops every generation of the agent, then deletes the agent and its threads. */
  deleteAgent(id: string): Promise<boolean>;
  listMessages(threadId: string): Message[] | undefined;
  send(threadId: string, text: string): SendResult;
  /** Stops the thread's active generation and resolves once its partial reply is saved. */
  stop(threadId: string): Promise<StopGenerationResponse>;
  subscribe(listener: ChatListener): () => void;
  close(): Promise<void>;
}

interface ActiveGeneration {
  readonly agentId: string;
  readonly controller: AbortController;
  readonly done: Promise<AssistantMessage>;
}

interface StartRun {
  readonly provider: ChatProvider;
  readonly model: string;
  readonly tools: AgentTools;
}

export function createChatService(options: ChatServiceOptions): ChatService {
  const { threads, messages, agents } = options;
  const listeners = new Set<ChatListener>();
  const active = new Map<string, ActiveGeneration>();
  const deletingThreads = new Set<string>();
  const deletingAgents = new Set<string>();
  let closed = false;

  const publish = (event: ChatEvent): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        options.report(error);
      }
    }
  };

  const stop = async (threadId: string): Promise<StopGenerationResponse> => {
    const generation = active.get(threadId);
    if (generation === undefined) return { kind: 'idle' };
    generation.controller.abort();
    return { kind: 'stopped', message: await generation.done };
  };

  const stopWhere = async (match: (threadId: string, generation: ActiveGeneration) => boolean): Promise<void> => {
    const threadIds = [...active].filter(([id, generation]) => match(id, generation)).map(([id]) => id);
    await Promise.all(threadIds.map((id) => stop(id)));
  };

  /** Runs `remove` with no generation running, and none able to start, in the threads it removes. */
  async function exclusively(
    keys: Set<string>,
    key: string,
    match: (threadId: string, generation: ActiveGeneration) => boolean,
    remove: () => boolean,
  ): Promise<boolean> {
    keys.add(key);
    try {
      await stopWhere(match);
      return remove();
    } finally {
      keys.delete(key);
    }
  }

  function start(thread: Thread, userMessage: UserMessage, run: StartRun): string {
    const generationId = options.newId();
    const controller = new AbortController();
    const ref = { threadId: thread.id, generationId };
    const runningTools = new Set<Promise<ToolResult>>();
    const tools: AgentTools = {
      run: (call, signal) => {
        if (controller.signal.aborted) return Promise.resolve({ kind: 'aborted' });
        const running = run.tools
          .run(call, signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]))
          .then((result) => {
            publish({ kind: 'generation.tool', ...ref, call, result });
            return result;
          });
        runningTools.add(running);
        void running.finally(() => runningTools.delete(running));
        return running;
      },
    };
    const done = generate({
      ...ref,
      provider: run.provider,
      model: run.model,
      history: messages.listByThread(thread.id),
      loadInstructions: async () => (await agents.readInstructions(thread.agentId)) ?? '',
      tools,
      signal: controller.signal,
      publish,
    }).then(async (result) => {
      controller.abort();
      await Promise.all(runningTools);
      const message = assistantMessage(options.newId(), thread.id, result, options.now());
      try {
        messages.insert(message);
        threads.touch(thread.id, message.createdAt);
      } catch (error) {
        options.report(error);
      }
      active.delete(thread.id);
      publish({ kind: 'generation.finished', ...ref, message });
      return message;
    });
    active.set(thread.id, { agentId: thread.agentId, controller, done });
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
    deleteThread: (id) => exclusively(deletingThreads, id, (threadId) => threadId === id, () => threads.delete(id)),
    deleteAgent: (id) =>
      exclusively(deletingAgents, id, (_threadId, generation) => generation.agentId === id, () => agents.delete(id)),
    listMessages: (threadId) => (threads.get(threadId) === undefined ? undefined : messages.listByThread(threadId)),
    send: (threadId, text) => {
      if (closed || deletingThreads.has(threadId)) return { kind: 'thread_not_found' };
      const thread = threads.get(threadId);
      if (thread === undefined || deletingAgents.has(thread.agentId)) return { kind: 'thread_not_found' };
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
          threads.touch(threadId, userMessage.createdAt);
          const generationId = start(thread, userMessage, {
            provider,
            model: agent.provider.model,
            tools: options.toolsFor(agent.workspace.dir),
          });
          return { kind: 'started', generationId, userMessage };
        }
      }
    },
    stop,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: async () => {
      closed = true;
      await stopWhere(() => true);
    },
  };
}
