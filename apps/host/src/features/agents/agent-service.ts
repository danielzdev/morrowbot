import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Agent, AgentInstructionsView, AgentWorkspace, AgentWorkspaceRequest, CreateAgentRequest, UpdateAgentRequest } from '@morrowbot/contracts';
import { clearStaging, createInstructions, guarded, readInstructionsText, readInstructionsView, saveInstructionsCopy, type CreateInstructionsResult, type SaveCopyResult, type WriteFailure } from './instructions-file.ts';

/** Where agent records are kept (the storage feature provides one). */
export interface AgentRecords {
  insert(agent: Agent): void;
  update(
    id: string,
    expectedRevision: number | undefined,
    change: (current: Agent) => Agent,
  ):
    | { readonly kind: 'updated'; readonly agent: Agent }
    | { readonly kind: 'not-found' }
    | { readonly kind: 'conflict'; readonly current: Agent };
  delete(id: string): boolean;
  get(id: string): Agent | undefined;
  list(): Agent[];
}

export interface AgentServiceOptions {
  readonly records: AgentRecords;
  /** Whether a folder exists, so agents are only filed into real folders. */
  readonly folderExists: (id: string) => boolean;
  /** Parent folder for dedicated workspaces: each agent gets `<workspacesDir>/<agentId>`. */
  readonly workspacesDir: string;
  /**
   * Where Save a copy keeps drafts: `<draftsDir>/<agentId>/<time>-<n>.md`, never in a workspace. Creating
   * `SOUL.md` stages it in `<draftsDir>/.staging`, which only the host writes.
   */
  readonly draftsDir: string;
  readonly newId: () => string;
  readonly now: () => string;
}

export type CreateAgentResult =
  | { readonly kind: 'created'; readonly agent: Agent }
  | { readonly kind: 'invalid'; readonly reason: string }
  /** The workspace has a `SOUL.md` already, so `initialInstructions` was not written and no agent was made. */
  | { readonly kind: 'instructions-occupied'; readonly current: AgentInstructionsView }
  | WriteFailure;


export type UpdateAgentResult =
  | { readonly kind: 'updated'; readonly agent: Agent }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'conflict'; readonly current: Agent }
  | { readonly kind: 'invalid'; readonly reason: string };

const NO_SUCH_FOLDER = 'folderId: No such folder';

export interface AgentService {
  list(): Agent[];
  get(id: string): Agent | undefined;
  create(request: CreateAgentRequest): Promise<CreateAgentResult>;
  update(id: string, request: UpdateAgentRequest): UpdateAgentResult;
  delete(id: string): boolean;
  /** Returns the agent's `SOUL.md` for a turn ('' when there is none), or undefined for an unknown agent. Throws when it is there but can't be read. */
  readInstructions(id: string): Promise<string | undefined>;
  /** What the editor shows: the text, its revision, and whether it can be read. Undefined for an unknown agent. */
  instructionsView(id: string): Promise<AgentInstructionsView | undefined>;
  /** Creates a missing `SOUL.md`; never replaces an entry that is there. Undefined for an unknown agent. */
  createInstructions(id: string, content: string): Promise<CreateInstructionsResult | undefined>;
  /** Saves `content` as a copy in the data folder and returns its file name. Undefined for an unknown agent. */
  saveInstructionsCopy(id: string, content: string): Promise<SaveCopyResult | undefined>;
  /** Removes staging files a create cut short left; the host runs it once at start. */
  clearStaging(): Promise<void>;
}

export function createAgentService(options: AgentServiceOptions): AgentService {
  const { records } = options;
  const stagingDir = path.join(options.draftsDir, '.staging');

  function workspaceFor(id: string, request: AgentWorkspaceRequest): AgentWorkspace | undefined {
    switch (request.kind) {
      case 'dedicated':
        return { kind: 'dedicated', dir: path.join(options.workspacesDir, id) };
      case 'shared':
        return path.isAbsolute(request.dir) ? { kind: 'shared', dir: path.resolve(request.dir) } : undefined;
    }
  }

  const unknownFolder = (folderId: string | null | undefined): boolean =>
    folderId !== undefined && folderId !== null && !options.folderExists(folderId);

  return {
    list: () => records.list(),
    get: (id) => records.get(id),
    create: async (request) => {
      if (unknownFolder(request.folderId)) return { kind: 'invalid', reason: NO_SUCH_FOLDER };
      const id = options.newId();
      const workspace = workspaceFor(id, request.workspace);
      if (workspace === undefined) return { kind: 'invalid', reason: 'workspace.dir: Use an absolute path on this computer' };
      const at = options.now();
      const agent: Agent = {
        id,
        name: request.name,
        description: request.description,
        workspace,
        avatar: request.avatar,
        provider: request.provider,
        folderId: request.folderId,
        emojiReplies: request.emojiReplies,
        disabledExtensions: request.disabledExtensions,
        revision: 0,
        createdAt: at,
        updatedAt: at,
      };
      const made = await guarded(async () => {
        await mkdir(agent.workspace.dir, { recursive: true });
        return null;
      });
      if (made !== null) return { kind: 'failed', message: `The workspace folder could not be made. ${made.message}` };
      if (unknownFolder(agent.folderId)) return { kind: 'invalid', reason: NO_SUCH_FOLDER };
      if (request.initialInstructions !== null) {
        const written = await createInstructions(stagingDir, agent.workspace.dir, request.initialInstructions);
        switch (written.kind) {
          case 'created':
            break;
          case 'occupied':
            return { kind: 'instructions-occupied', current: await readInstructionsView(agent.workspace.dir) };
          case 'failed':
            return { kind: 'failed', message: `SOUL.md was not written. ${written.message}` };
        }
      }
      if (unknownFolder(agent.folderId)) return { kind: 'invalid', reason: NO_SUCH_FOLDER };
      records.insert(agent);
      return { kind: 'created', agent };
    },
    update: (id, request) => {
      if (records.get(id) === undefined) return { kind: 'not-found' };
      if (unknownFolder(request.folderId)) return { kind: 'invalid', reason: NO_SUCH_FOLDER };
      return records.update(id, request.revision, (current) => ({
        ...current,
        name: request.name ?? current.name,
        description: request.description ?? current.description,
        avatar: request.avatar ?? current.avatar,
        provider: request.provider ?? current.provider,
        folderId: request.folderId === undefined ? current.folderId : request.folderId,
        emojiReplies: request.emojiReplies ?? current.emojiReplies,
        disabledExtensions: request.disabledExtensions ?? current.disabledExtensions,
        updatedAt: options.now(),
      }));
    },
    delete: (id) => records.delete(id),
    readInstructions: async (id) => {
      const agent = records.get(id);
      if (agent === undefined) return undefined;
      return readInstructionsText(agent.workspace.dir);
    },
    instructionsView: async (id) => {
      const agent = records.get(id);
      return agent === undefined ? undefined : readInstructionsView(agent.workspace.dir);
    },
    createInstructions: async (id, content) => {
      const agent = records.get(id);
      return agent === undefined ? undefined : createInstructions(stagingDir, agent.workspace.dir, content);
    },
    saveInstructionsCopy: async (id, content) => {
      const agent = records.get(id);
      return agent === undefined ? undefined : saveInstructionsCopy(path.join(options.draftsDir, agent.id), options.now(), content);
    },
    clearStaging: () => clearStaging(stagingDir),
  };
}
