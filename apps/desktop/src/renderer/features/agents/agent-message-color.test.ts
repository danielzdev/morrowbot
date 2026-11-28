import type { Agent } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import type { Appearance, AppearanceModel } from '../../shared/appearance.ts';
import type { BubbleColorOverride } from '../../shared/bubble-color.ts';
import { Store } from '../../shared/store.ts';
import { AgentGeneral } from './AgentGeneral.tsx';
import type { AgentsModel } from './agents-model.ts';

const AGENT: Agent = {
  id: 'agent-1',
  name: 'Scout',
  description: 'Helper',
  workspace: { kind: 'dedicated', dir: '/tmp/scout' },
  avatar: { kind: 'bot', shape: 'chat', color: '#10b981', finish: 'flat' },
  provider: { kind: 'unbound' },
  folderId: null,
  emojiReplies: 'allowed',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const BASE_APPEARANCE: Appearance = {
  theme: 'system',
  reduceMotion: 'system',
  chatWidth: 'normal',
  messageColor: { kind: 'match-bot' },
  agentMessageColors: {},
  reducedMotion: false,
  resolvedTheme: 'dark',
};

function makeAppearance(initial: Appearance): AppearanceModel {
  const state = new Store(initial);
  return {
    state,
    set: (patch) => {
      state.set({ ...state.get(), ...patch });
    },
    setAgentMessageColor: (agentId, override) => {
      const current = state.get();
      const others = Object.fromEntries(Object.entries(current.agentMessageColors).filter(([id]) => id !== agentId));
      const agentMessageColors: Readonly<Record<string, BubbleColorOverride>> =
        override === null ? others : { ...others, [agentId]: override };
      state.set({ ...current, agentMessageColors });
    },
    close: () => undefined,
  };
}

const STUB_AGENTS: Pick<AgentsModel, 'updateAgent'> = {
  updateAgent: () => Promise.resolve({ kind: 'saved', value: AGENT }),
};

function renderGeneral(appearance: AppearanceModel): string {
  return renderToString(
    h(AgentGeneral, {
      model: STUB_AGENTS,
      appearance,
      agent: AGENT,
      avatarEditor: () => null,
      redact: (text) => text,
      onDirty: () => undefined,
    }),
  );
}

it('shows what global resolves to by default, and switches cleanly between Off, Custom and Use global', () => {
  const appearance = makeAppearance(BASE_APPEARANCE);
  const usingGlobalMatchBot = renderGeneral(appearance);

  appearance.set({ messageColor: { kind: 'custom', color: '#0ea5e9' } });
  const usingGlobalCustom = renderGeneral(appearance);

  appearance.setAgentMessageColor(AGENT.id, { kind: 'off' });
  const agentOff = renderGeneral(appearance);

  appearance.setAgentMessageColor(AGENT.id, { kind: 'custom', color: '#f59e0b' });
  const agentCustom = renderGeneral(appearance);

  appearance.setAgentMessageColor(AGENT.id, null);
  const backToGlobal = renderGeneral(appearance);

  expect({
    usingGlobalMatchBot: usingGlobalMatchBot.includes('Using global · Matches bot') && usingGlobalMatchBot.includes('--user-bubble-bg'),
    usingGlobalCustom: usingGlobalCustom.includes('Using global · Custom (Sky)') && usingGlobalCustom.includes('--user-bubble-bg'),
    agentOff: agentOff.includes('Off for this agent (neutral)') && !agentOff.includes('--user-bubble-bg'),
    agentCustom: agentCustom.includes('Custom · Amber') && agentCustom.includes('bubble-color-picker') && agentCustom.includes('--user-bubble-bg'),
    backToGlobal: backToGlobal.includes('Using global · Custom (Sky)') && !backToGlobal.includes('bubble-color-picker'),
  }).toEqual({
    usingGlobalMatchBot: true,
    usingGlobalCustom: true,
    agentOff: true,
    agentCustom: true,
    backToGlobal: true,
  });
});
