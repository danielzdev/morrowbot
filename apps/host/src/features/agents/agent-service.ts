import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Agent, AgentWorkspace, AgentWorkspaceRequest, CreateAgentRequest, UpdateAgentRequest } from '@morrowbot/contracts';

export const INSTRUCTIONS_FILE = 'AGENTS.md';

/** Where agent records are kept (the storage feature provides one). */
export interface AgentRecords {
  insert(agent: Agent): void;
  update(agent: Agent): void;
  delete(id: string): boolean;
  get(id: string): Agent | undefined;
  list(): Agent[];
}

export interface AgentServiceOptions {
  readonly records: AgentRecords;
  /** Parent folder for dedicated workspaces: each agent gets `<workspacesDir>/<agentId>`. */
  readonly workspacesDir: string;
  readonly newId: () => string;
  readonly now: () => string;
}

export type CreateAgentResult =
  | { readonly kind: 'created'; readonly agent: Agent }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface AgentService {
  list(): Agent[];
  get(id: string): Agent | undefined;
  create(request: CreateAgentRequest): Promise<CreateAgentResult>;
  update(id: string, request: UpdateAgentRequest): Agent | undefined;
  delete(id: string): boolean;
  /** Returns the agent's `AGENTS.md` ('' when the file does not exist), or undefined for an unknown agent. */
  readInstructions(id: string): Promise<string | undefined>;
  /** Returns false for an unknown agent. */
  writeInstructions(id: string, content: string): Promise<boolean>;
}

export function createAgentService(options: AgentServiceOptions): AgentService {
  const { records } = options;

  function workspaceFor(id: string, request: AgentWorkspaceRequest): AgentWorkspace | undefined {
    switch (request.kind) {
      case 'dedicated':
        return { kind: 'dedicated', dir: path.join(options.workspacesDir, id) };
      case 'shared':
        return path.isAbsolute(request.dir) ? { kind: 'shared', dir: path.resolve(request.dir) } : undefined;
    }
  }

  return {
    list: () => records.list(),
    get: (id) => records.get(id),
    create: async (request) => {
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
        createdAt: at,
        updatedAt: at,
      };
      await mkdir(agent.workspace.dir, { recursive: true });
      records.insert(agent);
      return { kind: 'created', agent };
    },
    update: (id, request) => {
      const current = records.get(id);
      if (current === undefined) return undefined;
      const next: Agent = {
        ...current,
        name: request.name ?? current.name,
        description: request.description ?? current.description,
        avatar: request.avatar ?? current.avatar,
        provider: request.provider ?? current.provider,
        updatedAt: options.now(),
      };
      records.update(next);
      return next;
    },
    delete: (id) => records.delete(id),
    readInstructions: async (id) => {
      const agent = records.get(id);
      if (agent === undefined) return undefined;
      try {
        return await readFile(path.join(agent.workspace.dir, INSTRUCTIONS_FILE), 'utf8');
      } catch (error) {
        if (isMissingFile(error)) return '';
        throw error;
      }
    },
    writeInstructions: async (id, content) => {
      const agent = records.get(id);
      if (agent === undefined) return false;
      await mkdir(agent.workspace.dir, { recursive: true });
      const file = await followLink(path.join(agent.workspace.dir, INSTRUCTIONS_FILE));
      const temporary = `${file}.${options.newId()}.tmp`;
      try {
        await writeFile(temporary, content, 'utf8');
        await rename(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
      return true;
    },
  };
}

/** Saving replaces the file, so save through a symlinked `AGENTS.md` to the file it points at. */
async function followLink(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (error) {
    if (isMissingFile(error)) return file;
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
