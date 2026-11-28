import type {
  ChatEvent,
  ProviderUnavailableReason,
  Routine,
  RoutineRun,
  RoutineRunResult,
  SessionChoice,
  SessionChoiceReason,
  Thread,
  Wait,
} from '@morrowbot/contracts';

/** A routine as stored, without its last run. */
export type RoutineRecord = Omit<Routine, 'lastRun'>;

export type FinishedResult = Exclude<RoutineRunResult, { kind: 'running' | 'missed' }>;

/** Where routines, their runs and waits are kept (the storage feature provides them). */
export interface RoutineStore {
  readonly routines: {
    insert(routine: RoutineRecord): void;
    update(routine: RoutineRecord): boolean;
    delete(id: string): boolean;
    get(id: string): RoutineRecord | undefined;
    list(agentId?: string): RoutineRecord[];
    due(at: string): RoutineRecord[];
  };
  readonly runs: {
    insert(run: RoutineRun): void;
    finish(id: string, result: FinishedResult, threadId: string | null): boolean;
    latest(): Map<string, RoutineRun>;
    running(): RoutineRun[];
  };
  readonly waits: {
    insert(wait: Wait): void;
    get(waitId: string): Wait | undefined;
    listOpen(): Wait[];
    close(waitId: string, at: string, woken: boolean): boolean;
  };
  transaction<T>(work: () => T): T;
}

/** How a send was admitted, or why nothing was written (the chat feature's answer). */
export type ChatAdmit =
  | { readonly kind: 'started'; readonly generationId: string }
  | { readonly kind: 'thread_not_found' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'no_provider'; readonly reason: string }
  | { readonly kind: 'provider_unavailable'; readonly reason: ProviderUnavailableReason }
  | { readonly kind: 'binding_changed' }
  | { readonly kind: 'session_choice_required'; readonly reason: SessionChoiceReason }
  | { readonly kind: 'not_continuable'; readonly reason: string }
  | { readonly kind: 'attachments_missing' };

/** The chat a routine run posts in. */
export interface RoutineChat {
  agentExists(agentId: string): boolean;
  createThread(agentId: string, request: { readonly title: string }): Thread | undefined;
  /** An unattended send: refused as busy rather than queued, and its turn denies instead of asking for approval. */
  send(threadId: string, text: string, choice: SessionChoice): Promise<ChatAdmit>;
  deleteThread(id: string): Promise<boolean>;
  subscribe(listener: (event: ChatEvent) => void): () => void;
}

/** Real time for the schedule, and the timer that checks it. Tests drive both by hand. */
export interface RoutineClock {
  now(): number;
  every(ms: number, tick: () => void): () => void;
}
