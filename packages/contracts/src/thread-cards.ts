import { z } from 'zod';
import { EntityId, PluginId, Timestamp } from './ids.ts';
import { PluginKind, PluginPermission } from './plugin-manifest.ts';
import { UiBlocks, UiChoiceId } from './ui-blocks.ts';

/**
 * The host settings a Safe Setting card may switch: each is safe and reversible, and none touches security,
 * permissions, Safe Mode, the vault, or anything that deletes. Adding one is an owner decision.
 * `agent-emoji-replies`: whether the card's agent may answer with only an emoji, or nothing.
 */
export const SafeSettingId = z.enum(['agent-emoji-replies']);
export type SafeSettingId = z.infer<typeof SafeSettingId>;

/** What the host knew of the plugin when the card was made: read from its manifest, never written by the agent. */
export const PluginCardInfo = z.strictObject({
  name: z.string().min(1),
  description: z.string(),
  version: z.string().min(1),
  kind: PluginKind,
  permissions: z.array(PluginPermission),
});
export type PluginCardInfo = z.infer<typeof PluginCardInfo>;

/** `offered` until the user clicks Install (`installed`) or Cancel (`cancelled`); a plugin already on is `installed`. */
export const PluginCardState = z.enum(['offered', 'installed', 'cancelled']);
export type PluginCardState = z.infer<typeof PluginCardState>;

/**
 * What a card shows. `custom`: an agent's own blocks, drawn in a frame naming the agent, with the user's `answer`
 * once they chose. `plugin` and `setting` are the host's own cards, which only the owner's click acts on.
 */
export const CardBody = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('custom'), ui: UiBlocks, answer: UiChoiceId.nullable() }),
  z.strictObject({ kind: z.literal('plugin'), pluginId: PluginId, plugin: PluginCardInfo, state: PluginCardState }),
  /** `on` as the host last read it. */
  z.strictObject({ kind: z.literal('setting'), settingId: SafeSettingId, on: z.boolean() }),
]);
export type CardBody = z.infer<typeof CardBody>;

/**
 * A card an agent put in a chat during its turn `generationId`. `messageId` is null while the turn runs; the card
 * belongs to the reply once that is saved, and is dropped with a turn that saves none. `revision` grows with each
 * change, so a client keeps the newest copy it heard of.
 */
export const ThreadCard = z.strictObject({
  id: EntityId,
  threadId: EntityId,
  generationId: EntityId,
  messageId: EntityId.nullable(),
  agentId: EntityId,
  createdAt: Timestamp,
  revision: z.int().nonnegative(),
  body: CardBody,
});
export type ThreadCard = z.infer<typeof ThreadCard>;

/** `GET /api/ui/v1/threads/:id/cards`: the chat's cards, oldest first. */
export const ThreadCardList = z.strictObject({ cards: z.array(ThreadCard) });
export type ThreadCardList = z.infer<typeof ThreadCardList>;

/** What the `propose_card` tool takes: the agent's own blocks, or which plugin or setting the host should offer. */
export const CardProposal = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('custom'), ui: UiBlocks }),
  z.strictObject({ kind: z.literal('plugin'), pluginId: PluginId }),
  z.strictObject({ kind: z.literal('setting'), settingId: SafeSettingId }),
]);
export type CardProposal = z.infer<typeof CardProposal>;

/** `POST /api/ui/v1/threads/:id/cards/:cardId/act`: the user's click. The answer is the card as it is now. */
export const CardAction = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('choose'), choiceId: UiChoiceId }),
  z.strictObject({ kind: z.literal('install') }),
  z.strictObject({ kind: z.literal('cancel') }),
  z.strictObject({ kind: z.literal('set'), on: z.boolean() }),
]);
export type CardAction = z.infer<typeof CardAction>;
