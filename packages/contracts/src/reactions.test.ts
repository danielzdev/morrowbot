import { expect, it } from 'vitest';
import { effectiveEmojiReplies, isSingleEmoji, type AgentEmojiReplies, type EmojiRepliesSetting } from './index.ts';

it('takes exactly one complete emoji: skin tones, flags, keycaps and ZWJ sequences count as one', () => {
  const inputs = ['👍', '❤️', '👍🏽', '🇯🇵', '1️⃣', '🧑‍💻', '👨‍👩‍👧', '❤', '👍👍', '👍 ', 'ok', '', ':+1:'];
  expect(Object.fromEntries(inputs.map((input) => [JSON.stringify(input), isSingleEmoji(input)]))).toMatchInlineSnapshot(`
    {
      """": false,
      ""1️⃣"": true,
      "":+1:"": false,
      ""ok"": false,
      ""❤"": false,
      ""❤️"": true,
      ""🇯🇵"": true,
      ""👍 "": false,
      ""👍"": true,
      ""👍🏽"": true,
      ""👍👍"": false,
      ""👨‍👩‍👧"": true,
      ""🧑‍💻"": true,
    }
  `);
});

it('lets Settings › Chat decide for every agent, unless it is set to per agent', () => {
  const globals: readonly EmojiRepliesSetting[] = ['per_agent', 'all', 'off'];
  const own: readonly AgentEmojiReplies[] = ['allowed', 'off'];
  expect(globals.flatMap((global) => own.map((agent) => `${global} × ${agent} → ${effectiveEmojiReplies(global, agent)}`))).toMatchInlineSnapshot(`
    [
      "per_agent × allowed → allowed",
      "per_agent × off → off",
      "all × allowed → allowed",
      "all × off → allowed",
      "off × allowed → off",
      "off × off → off",
    ]
  `);
});
