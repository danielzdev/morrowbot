import type {
  Agent,
  AssistantMessage,
  Attachment,
  Message,
  PendingApproval,
  PluginEntry,
  QueuedMessage,
  QueuedMessageState,
  Thread,
  ThreadState,
  TurnOutcome,
  UserMessage,
} from '@morrowbot/contracts';
import type { ChatHost, ChatResult } from '../../lib/chat-host.ts';
import type { ThreadEvent, ThreadWatcher } from '../../lib/host-connection.ts';
import { SAMPLE_ACTIVE, SAMPLE_AGENTS, SAMPLE_MESSAGES, SAMPLE_PLUGINS, SAMPLE_PROVIDERS, SAMPLE_THREADS } from './sample-data.ts';

const EPOCH = 'sample';
const STEP_MS = 140;

type Active = NonNullable<ThreadState['activeTurn']>;

const ok = <T>(value: T): Promise<ChatResult<T>> => Promise.resolve({ kind: 'ok', value });
const missing = <T>(what: string): Promise<ChatResult<T>> =>
  Promise.resolve({ kind: 'failed', status: 404, error: { kind: 'not_found', message: `${what} not found` } });
const conflict = <T>(message: string): Promise<ChatResult<T>> => Promise.resolve({ kind: 'failed', status: 409, error: { kind: 'conflict', message } });
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * An in-memory host with made-up agents, so the chat can be tried before a host is paired: replies
 * stream word by word, run a tool, and ask for approval before writing anything.
 */
export function createSampleChatHost(now: () => string = () => new Date().toISOString()): ChatHost {
  let agents: Agent[] = [...SAMPLE_AGENTS];
  let threads: Thread[] = [...SAMPLE_THREADS];
  let plugins: PluginEntry[] = [...SAMPLE_PLUGINS];
  const messages = new Map<string, Message[]>(Object.entries(SAMPLE_MESSAGES).map(([id, list]) => [id, [...list]]));
  const copy = (turn: Active): Active => ({ ...turn, pendingApprovals: [...turn.pendingApprovals] });
  const active = new Map<string, Active>();
  for (const [threadId, turn] of Object.entries(SAMPLE_ACTIVE)) if (turn !== null) active.set(threadId, copy(turn));
  const seqs = new Map<string, number>();
  const watchers = new Map<string, Set<ThreadWatcher>>();
  const pluginListeners = new Set<(entry: PluginEntry) => void>();
  const answers = new Map<string, (choiceId: string | null) => void>();
  const uploads = new Map<string, Attachment>();
  const queues = new Map<string, QueuedMessage[]>();
  let counter = 0;
  const nextId = (prefix: string): string => `${prefix}-${String(++counter)}`;

  const emit = (threadId: string, generationId: string, body: DistributiveOmit<Exclude<ThreadEvent, { kind: 'queue.changed' }>, 'threadId' | 'generationId' | 'cursor'>): void => {
    const seq = (seqs.get(threadId) ?? 0) + 1;
    seqs.set(threadId, seq);
    const frame = { ...body, threadId, generationId, cursor: { hostEpoch: EPOCH, seq } };
    for (const watcher of watchers.get(threadId) ?? []) watcher.onEvent(frame);
  };

  const setQueue = (threadId: string, queue: QueuedMessage[]): void => {
    queues.set(threadId, queue);
    const seq = (seqs.get(threadId) ?? 0) + 1;
    seqs.set(threadId, seq);
    for (const watcher of watchers.get(threadId) ?? []) watcher.onEvent({ kind: 'queue.changed', threadId, cursor: { hostEpoch: EPOCH, seq }, queue: [...queue] });
  };
  const queueOf = (threadId: string): QueuedMessage[] => queues.get(threadId) ?? [];
  const delivered = (item: QueuedMessage): UserMessage => ({ kind: 'user', id: item.id, threadId: item.threadId, text: item.text, createdAt: now(), attachments: [] });

  /** Ends the turn. A finished reply sends the next queued message; a stopped one holds the queue. */
  const finish = (threadId: string, turn: Active, outcome: TurnOutcome): AssistantMessage => {
    const message: AssistantMessage = { kind: 'assistant', attachments: [], id: nextId('reply'), threadId, text: turn.text, createdAt: now(), outcome };
    active.delete(threadId);
    messages.set(threadId, [...(messages.get(threadId) ?? []), message]);
    emit(threadId, turn.generationId, { kind: 'generation.finished', message });
    const waiting = queueOf(threadId).filter(({ state }) => state.kind !== 'held');
    if (waiting.length === 0) return message;
    if (outcome.kind !== 'completed') {
      const held: QueuedMessageState = { kind: 'held', reason: 'Not sent: you stopped the reply.' };
      setQueue(threadId, queueOf(threadId).map((item) => (item.state.kind === 'held' ? item : { ...item, state: held })));
      return message;
    }
    const next = waiting.find(({ state }) => state.kind === 'steering') ?? waiting[0];
    if (next !== undefined) {
      setQueue(threadId, queueOf(threadId).filter(({ id }) => id !== next.id));
      start(threadId, delivered(next), next.text);
    }
    return message;
  };

  /** Steer now into a running turn: after a beat, the reply so far is saved as steered, and the turn answers the message. */
  const steerInto = async (threadId: string, turn: Active, item: QueuedMessage): Promise<void> => {
    setQueue(threadId, queueOf(threadId).map((each) => (each.id === item.id ? { ...each, state: { kind: 'steering', via: 'native' } } : each)));
    await sleep(STEP_MS * 4);
    if (active.get(threadId) !== turn) return;
    for (const approval of turn.pendingApprovals) answers.get(approval.approvalId)?.(null);
    const segment: AssistantMessage = { kind: 'assistant', attachments: [], id: nextId('reply'), threadId, text: turn.text, createdAt: now(), outcome: { kind: 'steered' } };
    const userMessage = delivered(item);
    const resumed: Active = { ...turn, text: '', pendingApprovals: [] };
    active.set(threadId, resumed);
    messages.set(threadId, [...(messages.get(threadId) ?? []), segment, userMessage]);
    emit(threadId, turn.generationId, { kind: 'generation.steered', segment, userMessage });
    setQueue(threadId, queueOf(threadId).filter(({ id }) => id !== item.id));
    void run(threadId, resumed, item.text);
  };

  const stream = async (threadId: string, turn: Active, text: string): Promise<boolean> => {
    for (const word of text.split(/(?<=\s)/)) {
      await sleep(STEP_MS / 3);
      if (active.get(threadId) !== turn) return false;
      turn.text += word;
      emit(threadId, turn.generationId, { kind: 'generation.delta', text: word });
    }
    return true;
  };

  const ask = (threadId: string, turn: Active, approval: PendingApproval): Promise<string | null> =>
    new Promise((resolve) => {
      turn.pendingApprovals.push(approval);
      answers.set(approval.approvalId, (choiceId) => {
        answers.delete(approval.approvalId);
        turn.pendingApprovals = turn.pendingApprovals.filter(({ approvalId }) => approvalId !== approval.approvalId);
        if (choiceId !== null) {
          emit(threadId, turn.generationId, {
            kind: 'generation.approval-resolved',
            approvalId: approval.approvalId,
            resolution: { kind: 'chosen', choiceId },
          });
        }
        resolve(choiceId);
      });
    });

  /** The rest of a turn after its approval: what the reply says depends on the answer. */
  const afterApproval = async (threadId: string, turn: Active, approval: PendingApproval): Promise<void> => {
    const choice = await ask(threadId, turn, approval);
    if (choice === null) return;
    const allowed = choice === 'allow';
    const toolUseId = nextId('tool');
    if (allowed) emit(threadId, turn.generationId, { kind: 'generation.tool-start', toolUseId, name: 'write_file', input: { path: 'notes/lisbon.md' } });
    await sleep(STEP_MS * 3);
    if (active.get(threadId) !== turn) return;
    if (allowed) emit(threadId, turn.generationId, { kind: 'generation.tool-end', toolUseId, outcome: 'ok' });
    const done = await stream(threadId, turn, allowed ? ' Saved. Want restaurant picks next?' : ' Okay, I left the file alone.');
    if (done) finish(threadId, turn, { kind: 'completed', finishReason: 'stop' });
  };

  const run = async (threadId: string, turn: Active, prompt: string): Promise<void> => {
    emit(threadId, turn.generationId, { kind: 'generation.status', state: 'running', queueNote: null, detail: 'Thinking' });
    await sleep(STEP_MS * 4);
    if (active.get(threadId) !== turn) return;
    const toolUseId = nextId('tool');
    emit(threadId, turn.generationId, { kind: 'generation.tool-start', toolUseId, name: 'search_notes', input: { query: prompt.slice(0, 60) } });
    await sleep(STEP_MS * 5);
    if (active.get(threadId) !== turn) return;
    emit(threadId, turn.generationId, { kind: 'generation.tool-end', toolUseId, outcome: 'ok' });
    const reply = `Here is what I found about **${prompt.slice(0, 40)}**:\n\n- Two notes mention it\n- One is from last week\n\n\`\`\`text\nnotes/inbox.md\n\`\`\``;
    if (!(await stream(threadId, turn, reply))) return;
    if (/save|write|edit/i.test(prompt)) {
      const approval = { approvalId: nextId('approval'), summary: 'Allow writing `notes/lisbon.md`?', choices: [{ id: 'deny', label: 'Deny' }, { id: 'allow', label: 'Allow' }] };
      emit(threadId, turn.generationId, { kind: 'generation.approval-requested', approval });
      await afterApproval(threadId, turn, approval);
      return;
    }
    finish(threadId, turn, { kind: 'completed', finishReason: 'stop' });
  };

  const start = (threadId: string, userMessage: UserMessage | null, prompt: string): string => {
    const generationId = nextId('gen');
    const turn: Active = { generationId, trigger: { kind: 'chat' }, state: 'running', queueNote: null, text: '', pendingApprovals: [], toolSteps: [] };
    active.set(threadId, turn);
    if (userMessage !== null) messages.set(threadId, [...(messages.get(threadId) ?? []), userMessage]);
    emit(threadId, generationId, { kind: 'generation.started', userMessage, state: 'running' });
    void run(threadId, turn, prompt);
    return generationId;
  };

  for (const [threadId, turn] of active) {
    for (const approval of turn.pendingApprovals.splice(0)) void afterApproval(threadId, turn, approval);
  }

  const stateOf = (thread: Thread): ThreadState => {
    const turn = active.get(thread.id);
    return {
      thread,
      messages: [...(messages.get(thread.id) ?? [])],
      reactions: [],
      toolSteps: [],
      activeTurn: turn === undefined ? null : copy(turn),
      blockedGroups: [],
      subagents: [],
      queue: [...queueOf(thread.id)],
      cursor: { hostEpoch: EPOCH, seq: seqs.get(thread.id) ?? 0 },
    };
  };

  return {
    hostName: 'Studio Host',
    agents: () => ok({ agents, folders: [], lastMessages: [] }),
    threads: (agentId) => ok({ threads: threads.filter((each) => each.agentId === agentId) }),
    createThread: (agentId) => {
      const created: Thread = { id: nextId('thread'), agentId, title: 'New chat', createdAt: now(), updatedAt: now() };
      threads = [...threads, created];
      return ok(created);
    },
    uploadAttachment: (_threadId, request) => {
      const id = nextId('file');
      const attachment: Attachment =
        request.kind === 'image'
          ? { kind: 'image', id, name: request.name, mimeType: request.mimeType, size: Math.floor((request.data.length * 3) / 4) }
          : { kind: 'text', id, name: request.name, size: new TextEncoder().encode(request.text).length };
      uploads.set(id, attachment);
      return ok(attachment);
    },
    send: (threadId, text, attachmentIds) => {
      if (active.has(threadId)) {
        if (attachmentIds.length > 0) {
          return Promise.resolve({ kind: 'failed', status: 409, error: { kind: 'conflict', message: 'Files can be sent once this reply ends. Send the text alone to queue it.' } });
        }
        const queued: QueuedMessage = { id: nextId('msg'), threadId, text, createdAt: now(), state: { kind: 'queued' } };
        setQueue(threadId, [...queueOf(threadId), queued]);
        return ok({ kind: 'queued', queued });
      }
      const attachments = attachmentIds.flatMap((id) => uploads.get(id) ?? []);
      for (const id of attachmentIds) uploads.delete(id);
      const userMessage: UserMessage = { kind: 'user', id: nextId('msg'), threadId, text, createdAt: now(), attachments };
      return ok({ kind: 'started', generationId: start(threadId, userMessage, text === '' ? 'your files' : text), userMessage });
    },
    continueTurn: (threadId, failedMessageId) => {
      const list = messages.get(threadId) ?? [];
      messages.set(threadId, list.filter(({ id }) => id !== failedMessageId));
      const prompt = list.findLast(({ kind }) => kind === 'user')?.text ?? 'your last message';
      return ok({ generationId: start(threadId, null, prompt) });
    },
    stop: (threadId) => {
      const turn = active.get(threadId);
      if (turn === undefined) return ok({ kind: 'idle' });
      for (const approval of turn.pendingApprovals) answers.get(approval.approvalId)?.(null);
      return ok({ kind: 'stopped', message: finish(threadId, turn, { kind: 'cancelled' }) });
    },
    steerQueued: (threadId, queuedId) => {
      const item = queueOf(threadId).find(({ id }) => id === queuedId);
      if (item === undefined) return missing('Queued message');
      if (item.state.kind === 'steering') return ok(null);
      if (queueOf(threadId).some(({ state }) => state.kind === 'steering')) return conflict('Another message is already on its way to the agent.');
      const turn = active.get(threadId);
      if (turn !== undefined) {
        void steerInto(threadId, turn, item);
        return ok(null);
      }
      setQueue(threadId, queueOf(threadId).filter(({ id }) => id !== queuedId));
      start(threadId, delivered(item), item.text);
      return ok(null);
    },
    cancelQueued: (threadId, queuedId) => {
      const item = queueOf(threadId).find(({ id }) => id === queuedId);
      if (item === undefined) return missing('Queued message');
      if (item.state.kind === 'steering') return conflict('This message is already on its way to the agent.');
      setQueue(threadId, queueOf(threadId).filter(({ id }) => id !== queuedId));
      return ok(null);
    },
    answerApproval: (_threadId, approvalId, reply) => {
      const answer = answers.get(approvalId);
      if (answer === undefined) return missing('Approval');
      answer(reply.choiceId);
      return ok(null);
    },
    providerInfo: (pluginId) => {
      const info = SAMPLE_PROVIDERS[pluginId];
      return info === undefined ? missing('Plugin') : ok({ info });
    },
    updateAgent: (agentId, request) => {
      const agent = agents.find(({ id }) => id === agentId);
      if (agent === undefined) return missing('Agent');
      const updated: Agent = {
        ...agent,
        name: request.name ?? agent.name,
        description: request.description ?? agent.description,
        avatar: request.avatar ?? agent.avatar,
        provider: request.provider ?? agent.provider,
        folderId: request.folderId === undefined ? agent.folderId : request.folderId,
        updatedAt: now(),
      };
      agents = agents.map((each) => (each.id === agentId ? updated : each));
      return ok(updated);
    },
    deleteAgent: (agentId) => {
      agents = agents.filter(({ id }) => id !== agentId);
      threads = threads.filter((each) => each.agentId !== agentId);
      return ok(null);
    },
    instructions: (agentId) => {
      const agent = agents.find(({ id }) => id === agentId);
      if (agent === undefined) return missing('Agent');
      return ok({ content: `# ${agent.name}\n\nKeep answers short. Ask before writing files.`, revision: 'r1', canReplace: false });
    },
    plugins: () => ok({ plugins, safeMode: false, pluginsDir: '/srv/morrowbot/plugins', problems: [] }),
    setPluginEnabled: (pluginId, enabled) => {
      const entry = plugins.find(({ manifest }) => manifest.id === pluginId);
      if (entry === undefined) return missing('Plugin');
      const updated: PluginEntry = { ...entry, enabled, status: enabled ? { kind: 'running' } : { kind: 'disabled' } };
      plugins = plugins.map((each) => (each.manifest.id === pluginId ? updated : each));
      for (const listener of [...pluginListeners]) listener(updated);
      return ok(updated);
    },
    onPluginChanged: (listener) => {
      pluginListeners.add(listener);
      return () => {
        pluginListeners.delete(listener);
      };
    },
    watch: (threadId, watcher) => {
      const set = watchers.get(threadId) ?? new Set();
      watchers.set(threadId, set);
      let watching = true;
      void Promise.resolve().then(() => {
        if (!watching) return;
        const thread = threads.find(({ id }) => id === threadId);
        if (thread === undefined) {
          watcher.onGone();
          return;
        }
        watcher.onFresh(stateOf(thread));
        set.add(watcher);
      });
      return () => {
        watching = false;
        set.delete(watcher);
      };
    },
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
