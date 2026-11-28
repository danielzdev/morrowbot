import type { Agent, AgentEmojiReplies, EmojiRepliesSetting, SafeSettingId } from '@morrowbot/contracts';

/** What the allowlisted settings read and write (the agents and storage features provide it). */
export interface SafeSettingPorts {
  agent(id: string): Agent | undefined;
  /** Settings › Chat › Emoji-only / silent replies, which can decide for every agent. */
  globalEmojiReplies(): EmojiRepliesSetting;
  /** False when the agent is gone. */
  setAgentEmojiReplies(agentId: string, value: AgentEmojiReplies): boolean;
}

/** A setting's value for the card's agent, or why a card cannot switch it now. */
export type SettingRead = { readonly kind: 'value'; readonly on: boolean } | { readonly kind: 'unavailable'; readonly reason: string };

interface SafeSetting {
  read(agent: Agent, ports: SafeSettingPorts): SettingRead;
  /** False when the agent is gone. */
  write(agentId: string, on: boolean, ports: SafeSettingPorts): boolean;
}

/** The only settings a card can switch: one entry per `SafeSettingId`, each reading and writing one agent's own value. */
const SAFE_SETTINGS: Readonly<Record<SafeSettingId, SafeSetting>> = {
  'agent-emoji-replies': {
    read: (agent, ports) =>
      ports.globalEmojiReplies() === 'per_agent'
        ? { kind: 'value', on: agent.emojiReplies === 'allowed' }
        : { kind: 'unavailable', reason: 'Settings › Chat decides emoji-only and silent replies for every agent now, so this agent’s own setting has no effect.' },
    write: (agentId, on, ports) => ports.setAgentEmojiReplies(agentId, on ? 'allowed' : 'off'),
  },
};

/** The setting as the card's agent `agentId` has it. */
export function readSafeSetting(id: SafeSettingId, agentId: string, ports: SafeSettingPorts): SettingRead {
  const agent = ports.agent(agentId);
  return agent === undefined ? { kind: 'unavailable', reason: 'The agent is gone.' } : SAFE_SETTINGS[id].read(agent, ports);
}

/** Switches the setting for the card's agent and reads it back. */
export function writeSafeSetting(id: SafeSettingId, agentId: string, on: boolean, ports: SafeSettingPorts): SettingRead {
  const before = readSafeSetting(id, agentId, ports);
  if (before.kind === 'unavailable') return before;
  if (!SAFE_SETTINGS[id].write(agentId, on, ports)) return { kind: 'unavailable', reason: 'The agent is gone.' };
  return readSafeSetting(id, agentId, ports);
}
