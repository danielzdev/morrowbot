import type { Agent } from '@morrowbot/contracts';
import { describe, expect, it } from 'vitest';
import { isPluginEnabledForAgent, nextDisabledForAgent } from './agent-extensions.ts';

const AGENT: Agent = {
  id: 'agent-1',
  name: 'Errand Bot',
  description: '',
  workspace: { kind: 'dedicated', dir: '/srv/agents/errands' },
  avatar: { kind: 'bot', shape: 'lightbulb', color: '#3b82f6', finish: 'matte' },
  provider: { kind: 'unbound' },
  folderId: null,
  emojiReplies: 'allowed',
  disabledExtensions: ['notes-sync'],
  revision: 2,
  createdAt: '2026-11-28T00:00:00.000Z',
  updatedAt: '2026-11-28T00:00:00.000Z',
};

describe('per-agent extension toggle helpers', () => {
  it('treats unlisted tool plugins as enabled and toggles without duplicates', () => {
    expect(isPluginEnabledForAgent(AGENT, 'web-search')).toBe(true);
    expect(isPluginEnabledForAgent(AGENT, 'notes-sync')).toBe(false);
    expect(nextDisabledForAgent(AGENT, 'web-search', false)).toEqual(['notes-sync', 'web-search']);
    expect(nextDisabledForAgent(AGENT, 'notes-sync', false)).toEqual(['notes-sync']);
    expect(nextDisabledForAgent(AGENT, 'notes-sync', true)).toEqual([]);
  });
});
