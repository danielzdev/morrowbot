import { z } from 'zod';
import { EntityId, PluginId, Timestamp } from './ids.ts';

/** POSIX (`/x`), Windows drive (`C:\x`) or UNC (`\\server\share`) absolute paths. */
const AbsolutePath = z.string().regex(/^(\/|[A-Za-z]:[\\/]|\\\\)/, 'Use an absolute path');

/** Where an agent works. A dedicated folder belongs to one agent; a shared folder may be used by several. */
export const AgentWorkspace = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('dedicated'), dir: AbsolutePath }),
  z.strictObject({ kind: z.literal('shared'), dir: AbsolutePath }),
]);
export type AgentWorkspace = z.infer<typeof AgentWorkspace>;

export const AgentWorkspaceRequest = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('dedicated') }),
  z.strictObject({ kind: z.literal('shared'), dir: AbsolutePath }),
]);
export type AgentWorkspaceRequest = z.infer<typeof AgentWorkspaceRequest>;

export const AgentAvatar = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('initials'), color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb color') }),
]);
export type AgentAvatar = z.infer<typeof AgentAvatar>;

export const ProviderBinding = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unbound') }),
  z.strictObject({ kind: z.literal('bound'), pluginId: PluginId, model: z.string().min(1) }),
]);
export type ProviderBinding = z.infer<typeof ProviderBinding>;

const AgentName = z.string().trim().min(1).max(200);
const AgentDescription = z.string().max(2000);

export const Agent = z.strictObject({
  id: EntityId,
  name: AgentName,
  description: AgentDescription,
  workspace: AgentWorkspace,
  avatar: AgentAvatar,
  provider: ProviderBinding,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Agent = z.infer<typeof Agent>;

export const CreateAgentRequest = z.strictObject({
  name: AgentName,
  description: AgentDescription.default(''),
  workspace: AgentWorkspaceRequest.default({ kind: 'dedicated' }),
  avatar: AgentAvatar.default({ kind: 'initials', color: '#6b7280' }),
  provider: ProviderBinding.default({ kind: 'unbound' }),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequest>;

export const UpdateAgentRequest = z.strictObject({
  name: AgentName.optional(),
  description: AgentDescription.optional(),
  avatar: AgentAvatar.optional(),
  provider: ProviderBinding.optional(),
});
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequest>;

/** The contents of the agent's `AGENTS.md` instruction file. */
export const AgentInstructions = z.strictObject({ content: z.string().max(1_000_000) });
export type AgentInstructions = z.infer<typeof AgentInstructions>;
