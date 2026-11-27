import { z } from 'zod';
import { EntityId, PluginId, Timestamp } from './ids.ts';
import { AccessLevel, ModelSelection, VendorSettings } from './provider.ts';

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

/** The bot's silhouette. */
export const AvatarShape = z.enum(['chat', 'controller', 'barbell', 'mug', 'lightbulb', 'sprout', 'watering-can']);
export type AvatarShape = z.infer<typeof AvatarShape>;

/** The bot's surface. */
export const AvatarFinish = z.enum(['flat', 'fluffy', 'matte', 'metallic']);
export type AvatarFinish = z.infer<typeof AvatarFinish>;

export const AgentAvatar = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('bot'),
    shape: AvatarShape,
    color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb color'),
    finish: AvatarFinish,
  }),
]);
export type AgentAvatar = z.infer<typeof AgentAvatar>;

/** The avatar of an agent created without one, and of agents saved before avatars had a shape. */
export const DEFAULT_AVATAR: AgentAvatar = { kind: 'bot', shape: 'chat', color: '#6b7280', finish: 'flat' };

export const ProviderBinding = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unbound') }),
  z.strictObject({
    kind: z.literal('bound'),
    pluginId: PluginId,
    selection: ModelSelection,
    access: AccessLevel,
    vendorSettings: VendorSettings,
  }),
]);
export type ProviderBinding = z.infer<typeof ProviderBinding>;

const FolderName = z.string().trim().min(1).max(80);

/** A user-made group of agents in the sidebar. */
export const Folder = z.strictObject({ id: EntityId, name: FolderName, createdAt: Timestamp });
export type Folder = z.infer<typeof Folder>;

export const CreateFolderRequest = z.strictObject({ name: FolderName });
export type CreateFolderRequest = z.infer<typeof CreateFolderRequest>;

export const UpdateFolderRequest = z.strictObject({ name: FolderName });
export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequest>;

const AgentName = z.string().trim().min(1).max(200);
const AgentDescription = z.string().max(2000);

export const Agent = z.strictObject({
  id: EntityId,
  name: AgentName,
  description: AgentDescription,
  workspace: AgentWorkspace,
  avatar: AgentAvatar,
  provider: ProviderBinding,
  folderId: EntityId.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Agent = z.infer<typeof Agent>;

export const CreateAgentRequest = z.strictObject({
  name: AgentName,
  description: AgentDescription.default(''),
  workspace: AgentWorkspaceRequest.default({ kind: 'dedicated' }),
  avatar: AgentAvatar.default(DEFAULT_AVATAR),
  provider: ProviderBinding.default({ kind: 'unbound' }),
  folderId: EntityId.nullable().default(null),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequest>;

export const UpdateAgentRequest = z.strictObject({
  name: AgentName.optional(),
  description: AgentDescription.optional(),
  avatar: AgentAvatar.optional(),
  provider: ProviderBinding.optional(),
  /** `null` moves the agent out of its folder; left out, the folder is unchanged. */
  folderId: EntityId.nullable().optional(),
});
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequest>;

/** The newest non-empty message of an agent, across all its threads, as the sidebar previews it. */
export const LastMessage = z.strictObject({
  agentId: EntityId,
  threadId: EntityId,
  kind: z.enum(['user', 'assistant']),
  preview: z.string().max(401),
  at: Timestamp,
});
export type LastMessage = z.infer<typeof LastMessage>;

/** The contents of the agent's `AGENTS.md` instruction file. */
export const AgentInstructions = z.strictObject({ content: z.string().max(1_000_000) });
export type AgentInstructions = z.infer<typeof AgentInstructions>;
