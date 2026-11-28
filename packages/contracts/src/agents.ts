import { z } from 'zod';
import { EntityId, PluginId, Timestamp } from './ids.ts';
import { AccessLevel, ModelSelection, VendorSettings } from './provider.ts';
import { AgentEmojiReplies } from './reactions.ts';

/** A saved copy's file name: its UTC time with `-` for `:`, then a counter. */
export const INSTRUCTIONS_COPY_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-\d{1,6}\.md$/;

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
export const AvatarShape = z.enum([
  'chat',
  'controller',
  'barbell',
  'mug',
  'lightbulb',
  'sprout',
  'watering-can',
  'star',
  'cloud',
  'bolt',
  'flame',
  'heart',
  'book',
  'ghost',
  'shield',
]);
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

export const BoundProvider = z.strictObject({
  kind: z.literal('bound'),
  pluginId: PluginId,
  selection: ModelSelection,
  access: AccessLevel,
  vendorSettings: VendorSettings,
});
export type BoundProvider = z.infer<typeof BoundProvider>;

export const ProviderBinding = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('unbound') }), BoundProvider]);
export type ProviderBinding = z.infer<typeof ProviderBinding>;

const FolderName = z.string().trim().min(1).max(80);

/** A user-made group of agents in the sidebar. */
export const Folder = z.strictObject({ id: EntityId, name: FolderName, createdAt: Timestamp });
export type Folder = z.infer<typeof Folder>;

export const CreateFolderRequest = z.strictObject({ name: FolderName });
export type CreateFolderRequest = z.infer<typeof CreateFolderRequest>;

export const UpdateFolderRequest = z.strictObject({ name: FolderName });
export type UpdateFolderRequest = z.infer<typeof UpdateFolderRequest>;

const InstructionsText = z.string().max(1_000_000);

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
  /** Whether the agent may answer with only an emoji or nothing; Settings › Chat may override it. */
  emojiReplies: AgentEmojiReplies.default('allowed'),
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
  emojiReplies: AgentEmojiReplies.default('allowed'),
  /** Written to the new workspace's `AGENTS.md` only if no file or symlink is there yet. */
  initialInstructions: InstructionsText.nullable().default(null),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequest>;

export const UpdateAgentRequest = z.strictObject({
  name: AgentName.optional(),
  description: AgentDescription.optional(),
  avatar: AgentAvatar.optional(),
  provider: ProviderBinding.optional(),
  /** `null` moves the agent out of its folder; left out, the folder is unchanged. */
  folderId: EntityId.nullable().optional(),
  emojiReplies: AgentEmojiReplies.optional(),
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

/**
 * The agent's `AGENTS.md` as the host found it. `revision` is null only for a missing entry; `content`
 * is null when the text can't be read (missing, a dangling symlink, unreadable), and `readError` then
 * says why for an entry that is there. `canReplace` is false until the host can replace a file safely.
 */
export const AgentInstructionsView = z.strictObject({
  content: InstructionsText.nullable(),
  revision: z.string().min(1).nullable(),
  canReplace: z.boolean(),
  readError: z.string().min(1).optional(),
});
export type AgentInstructionsView = z.infer<typeof AgentInstructionsView>;

/** Creates a missing `AGENTS.md` (`expectedRevision: null`). The host never replaces an existing one yet. */
export const PutInstructionsRequest = z.strictObject({ content: InstructionsText, expectedRevision: z.string().min(1).nullable() });
export type PutInstructionsRequest = z.infer<typeof PutInstructionsRequest>;

export const PutInstructionsReply = z.strictObject({ revision: z.string().min(1) });
export type PutInstructionsReply = z.infer<typeof PutInstructionsReply>;

/** Keeps a draft in the data folder; the live `AGENTS.md` is not touched. */
export const InstructionsCopyRequest = z.strictObject({ content: InstructionsText });
export type InstructionsCopyRequest = z.infer<typeof InstructionsCopyRequest>;

/** `revealId` names the saved copy for Reveal in Finder; it is a file name, never a path. */
export const InstructionsCopyReply = z.strictObject({ revealId: z.string().regex(INSTRUCTIONS_COPY_NAME) });
export type InstructionsCopyReply = z.infer<typeof InstructionsCopyReply>;
