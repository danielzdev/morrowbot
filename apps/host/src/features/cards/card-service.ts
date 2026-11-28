import {
  choicesOf,
  type CardAction,
  type CardBody,
  type CardProposal,
  type PluginCardInfo,
  type PluginKind,
  type PluginPermission,
  type ThreadCard,
} from '@morrowbot/contracts';
import { readSafeSetting, writeSafeSetting, type SafeSettingPorts } from './safe-settings.ts';

/** Who a tool call acts as: a running turn of `agentId` in `threadId`. */
export interface CardGrant {
  readonly turnId: string;
  readonly agentId: string;
  readonly threadId: string;
}

/** A plugin the host found in the built-in or user plugins folder: the Marketplace of this version. */
export interface MarketplacePlugin {
  readonly manifest: {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly version: string;
    readonly kind: PluginKind;
    readonly permissions: readonly PluginPermission[];
  };
}

export interface CardServiceOptions {
  readonly store: { get(id: string): ThreadCard | undefined; update(card: ThreadCard): void; listByThread(threadId: string): ThreadCard[] };
  /** The chat feature: stages a running turn's card and tells windows about changes. */
  readonly chat: {
    stageCard(grant: CardGrant, body: CardBody): { readonly kind: 'staged'; readonly card: ThreadCard } | { readonly kind: 'refused'; readonly reason: string };
    publishCard(card: ThreadCard): void;
  };
  readonly plugins: {
    list(): readonly MarketplacePlugin[];
    enabled(pluginId: string): Promise<boolean>;
    setEnabled(pluginId: string, enabled: boolean): Promise<void>;
  };
  readonly settings: SafeSettingPorts;
}

export type CardToolAnswer = { readonly kind: 'done'; readonly value: object } | { readonly kind: 'refused'; readonly reason: string };

/** How a click ended. Every refusal changed nothing. */
export type ActAnswer =
  | { readonly kind: 'done'; readonly card: ThreadCard }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_sent' }
  | { readonly kind: 'forbidden' | 'conflict' | 'invalid'; readonly reason: string };

/** Who clicked: only the owner's click acts on the host's own cards. */
export interface Clicker {
  readonly owner: boolean;
}

/** Sends the chosen label as the user's message; false when the chat refused it (the caller keeps why). */
export type SendChoice = (text: string) => Promise<boolean>;

export interface CardService {
  propose(grant: CardGrant, proposal: CardProposal): Promise<CardToolAnswer>;
  searchMarketplace(query: string): Promise<CardToolAnswer>;
  /** The chat's cards, oldest first, with each setting as it is now. */
  list(threadId: string): ThreadCard[];
  act(threadId: string, cardId: string, action: CardAction, clicker: Clicker, send: SendChoice): Promise<ActAnswer>;
}

const OWNER_ONLY = 'Only the server owner can use this card.';

/** Whether the plugin in the folder now is the one the card showed: same version, kind and permissions. */
function sameAsShown({ manifest }: MarketplacePlugin, shown: PluginCardInfo): boolean {
  return (
    manifest.version === shown.version &&
    manifest.kind === shown.kind &&
    manifest.permissions.length === shown.permissions.length &&
    manifest.permissions.every((permission) => shown.permissions.includes(permission))
  );
}

export function createCardService(options: CardServiceOptions): CardService {
  const { store, chat, plugins, settings } = options;
  const findPlugin = (id: string): MarketplacePlugin | undefined => plugins.list().find(({ manifest }) => manifest.id === id);
  /** Cards with a click in progress: a second click waits for none and changes nothing. */
  const busy = new Set<string>();

  async function bodyOf(grant: CardGrant, proposal: CardProposal): Promise<CardBody | string> {
    switch (proposal.kind) {
      case 'custom':
        return { kind: 'custom', ui: proposal.ui, answer: null };
      case 'plugin': {
        const found = findPlugin(proposal.pluginId);
        if (found === undefined) return `No plugin "${proposal.pluginId}" is in the Marketplace. Call search_marketplace to see which are.`;
        const { name, description, version, kind, permissions } = found.manifest;
        const state = (await plugins.enabled(proposal.pluginId)) ? 'installed' : 'offered';
        return { kind: 'plugin', pluginId: proposal.pluginId, plugin: { name, description, version, kind, permissions: [...permissions] }, state };
      }
      case 'setting': {
        const read = readSafeSetting(proposal.settingId, grant.agentId, settings);
        return read.kind === 'value' ? { kind: 'setting', settingId: proposal.settingId, on: read.on } : read.reason;
      }
    }
  }

  /** Saves `body` as the card's next revision and tells the chat's windows; undefined when the chat was deleted meanwhile. */
  function change(card: ThreadCard, body: CardBody): ThreadCard | undefined {
    const latest = store.get(card.id);
    if (latest === undefined) return undefined;
    const next: ThreadCard = { ...latest, revision: latest.revision + 1, body };
    store.update(next);
    chat.publishCard(next);
    return next;
  }

  const ended = (card: ThreadCard | undefined): ActAnswer => (card === undefined ? { kind: 'not_found' } : { kind: 'done', card });

  async function actOn(card: ThreadCard, action: CardAction, clicker: Clicker, send: SendChoice): Promise<ActAnswer> {
    const { body } = card;
    switch (body.kind) {
      case 'custom': {
        if (action.kind !== 'choose') return { kind: 'invalid', reason: 'This card takes a choice.' };
        const choice = choicesOf(body.ui).find(({ id }) => id === action.choiceId);
        if (choice === undefined) return { kind: 'invalid', reason: 'This card has no such choice.' };
        if (body.answer !== null) return { kind: 'conflict', reason: 'This card was answered already.' };
        const answered = change(card, { ...body, answer: choice.id });
        if (answered === undefined) return { kind: 'not_found' };
        let sent = false;
        try {
          sent = await send(choice.label);
        } finally {
          if (!sent) change(answered, body);
        }
        return sent ? { kind: 'done', card: answered } : { kind: 'not_sent' };
      }
      case 'plugin': {
        if (action.kind !== 'install' && action.kind !== 'cancel') return { kind: 'invalid', reason: 'This card takes Install or Cancel.' };
        if (!clicker.owner) return { kind: 'forbidden', reason: OWNER_ONLY };
        if (body.state !== 'offered') return { kind: 'conflict', reason: body.state === 'installed' ? 'This plugin is installed already.' : 'This card was cancelled.' };
        if (action.kind === 'cancel') return ended(change(card, { ...body, state: 'cancelled' }));
        const found = findPlugin(body.pluginId);
        if (found === undefined) return { kind: 'conflict', reason: 'This plugin is no longer in the plugins folder.' };
        if (!sameAsShown(found, body.plugin)) return { kind: 'conflict', reason: 'This plugin changed since the card was shown. Ask the agent for a new card.' };
        await plugins.setEnabled(body.pluginId, true);
        return ended(change(card, { ...body, state: 'installed' }));
      }
      case 'setting': {
        if (action.kind !== 'set') return { kind: 'invalid', reason: 'This card takes on or off.' };
        if (!clicker.owner) return { kind: 'forbidden', reason: OWNER_ONLY };
        const read = writeSafeSetting(body.settingId, card.agentId, action.on, settings);
        if (read.kind === 'unavailable') return { kind: 'conflict', reason: read.reason };
        return ended(change(card, { ...body, on: read.on }));
      }
    }
  }

  return {
    propose: async (grant, proposal) => {
      const body = await bodyOf(grant, proposal);
      if (typeof body === 'string') return { kind: 'refused', reason: body };
      const staged = chat.stageCard(grant, body);
      if (staged.kind === 'refused') return staged;
      return {
        kind: 'done',
        value: { cardId: staged.card.id, note: 'The card shows in the desktop chat now and stays with your reply. Say in a line what it offers or asks: the phone app shows only your text.' },
      };
    },
    searchMarketplace: async (query) => {
      const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
      const matches = plugins.list().filter(({ manifest }) => {
        const text = `${manifest.id} ${manifest.name} ${manifest.description}`.toLowerCase();
        return words.every((word) => text.includes(word));
      });
      const found = await Promise.all(
        matches.map(async ({ manifest }) => ({
          pluginId: manifest.id,
          name: manifest.name,
          description: manifest.description,
          kind: manifest.kind,
          permissions: manifest.permissions,
          installed: await plugins.enabled(manifest.id),
        })),
      );
      return {
        kind: 'done',
        value: { plugins: found, note: 'These are the plugins in Ori Kami’s plugins folders. Offer one with propose_card (kind "plugin").' },
      };
    },
    list: (threadId) =>
      store.listByThread(threadId).map((card) => {
        if (card.body.kind !== 'setting') return card;
        const read = readSafeSetting(card.body.settingId, card.agentId, settings);
        return read.kind === 'value' && read.on !== card.body.on ? { ...card, body: { ...card.body, on: read.on } } : card;
      }),
    act: async (threadId, cardId, action, clicker, send) => {
      const card = store.get(cardId);
      if (card?.threadId !== threadId) return { kind: 'not_found' };
      if (card.messageId === null) return { kind: 'conflict', reason: 'This card works once the reply is done.' };
      if (busy.has(cardId)) return { kind: 'conflict', reason: 'This card is still working on the last click.' };
      busy.add(cardId);
      try {
        return await actOn(card, action, clicker, send);
      } finally {
        busy.delete(cardId);
      }
    },
  };
}
