import { expect, it } from 'vitest';
import { AppearanceChoices } from './appearance.ts';

it('upgrades older saved preferences cleanly to Match bot and refuses invalid values', () => {
  expect({
    oldest: AppearanceChoices.safeParse({ theme: 'dark', reduceMotion: 'on' }).data,
    preMessageColor: AppearanceChoices.safeParse({ theme: 'light', reduceMotion: 'system', chatWidth: 'wide' }).data,
    current: AppearanceChoices.safeParse({
      theme: 'light',
      reduceMotion: 'system',
      chatWidth: 'wide',
      messageColor: { kind: 'custom', color: '#0EA5E9' },
      agentMessageColors: {
        'agent-1': { kind: 'off' },
        'agent-2': { kind: 'custom', color: '#10B981' },
      },
      sendInAgentColor: false,
    }).data,
    badWidth: AppearanceChoices.safeParse({ theme: 'light', reduceMotion: 'system', chatWidth: 'huge' }).success,
    badHex: AppearanceChoices.safeParse({ theme: 'light', reduceMotion: 'system', messageColor: { kind: 'custom', color: 'not-a-color' } }).success,
    badOverride: AppearanceChoices.safeParse({ theme: 'light', reduceMotion: 'system', agentMessageColors: { 'agent-1': { kind: 'bogus' } } }).success,
    badSendColor: AppearanceChoices.safeParse({ theme: 'light', reduceMotion: 'system', sendInAgentColor: 'yes' }).success,
  }).toEqual({
    oldest: { theme: 'dark', reduceMotion: 'on', chatWidth: 'normal', messageColor: { kind: 'match-bot' }, agentMessageColors: {}, sendInAgentColor: true },
    preMessageColor: { theme: 'light', reduceMotion: 'system', chatWidth: 'wide', messageColor: { kind: 'match-bot' }, agentMessageColors: {}, sendInAgentColor: true },
    current: {
      theme: 'light',
      reduceMotion: 'system',
      chatWidth: 'wide',
      messageColor: { kind: 'custom', color: '#0ea5e9' },
      agentMessageColors: {
        'agent-1': { kind: 'off' },
        'agent-2': { kind: 'custom', color: '#10b981' },
      },
      sendInAgentColor: false,
    },
    badWidth: false,
    badHex: false,
    badOverride: false,
    badSendColor: false,
  });
});
