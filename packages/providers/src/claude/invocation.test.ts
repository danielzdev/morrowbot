import { expect, it } from 'vitest';
import { effortOf } from './info.ts';
import { buildInvocation } from './invocation.ts';

/** The invocation with its stdin frame read back, after checking the frame is one NDJSON line. */
function shown(invocation: ReturnType<typeof buildInvocation>) {
  const lines = invocation.frame.split('\n');
  expect(lines.length === 2 && lines[1] === '').toBe(true);
  const frame: unknown = JSON.parse(invocation.frame);
  return { ...invocation, frame };
}

it('runs read-only and isolated, with the model, system prompt file and seeded conversation', () => {
  expect(
    shown(buildInvocation({
      access: 'read-only',
      mode: 'interactive',
      selection: { kind: 'model', id: 'opus', choices: {} },
      system: 'Be brief.',
      seed: '<user>\nName a fish.\n</user>\n<assistant>\nKoi.\n</assistant>',
      prompt: 'Another?',
      effort: null,
    })),
  ).toMatchInlineSnapshot(`
    {
      "args": [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--safe-mode",
        "--strict-mcp-config",
        "--restricted",
        "--tools",
        "Read,Glob,Grep",
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--model",
        "opus",
        "--append-system-prompt-file",
        "/dev/fd/4",
      ],
      "files": [
        "Be brief.",
      ],
      "frame": {
        "message": {
          "content": "Continue this conversation. Reply to the last user message.

    <conversation>
    <user>
    Name a fish.
    </user>
    <assistant>
    Koi.
    </assistant>
    <user>
    Another?
    </user>
    </conversation>",
          "role": "user",
        },
        "type": "user",
      },
    }
  `);
});

it('sends an unseeded prompt as is, with no model or system flags', () => {
  expect(shown(buildInvocation({ access: 'read-only', mode: 'background', selection: { kind: 'default' }, system: null, seed: null, prompt: 'hi', effort: null }))).toMatchInlineSnapshot(`
    {
      "args": [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--safe-mode",
        "--strict-mcp-config",
        "--restricted",
        "--tools",
        "Read,Glob,Grep",
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
      ],
      "files": [],
      "frame": {
        "message": {
          "content": "hi",
          "role": "user",
        },
        "type": "user",
      },
    }
  `);
});

it('lets workspace-write edit with the file tools only, asking the host interactively and nobody in the background', () => {
  const flags = (mode: 'interactive' | 'background') =>
    buildInvocation({ access: 'workspace-write', mode, selection: { kind: 'default' }, system: null, seed: null, prompt: 'hi', effort: null }).args.slice(10);
  expect({ interactive: flags('interactive'), background: flags('background') }).toMatchInlineSnapshot(`
    {
      "background": [
        "--restricted",
        "--tools",
        "Read,Glob,Grep,Edit,Write",
        "--permission-mode",
        "acceptEdits",
        "--permission-prompts",
        "none",
      ],
      "interactive": [
        "--restricted",
        "--tools",
        "Read,Glob,Grep,Edit,Write",
        "--permission-mode",
        "acceptEdits",
        "--permission-prompts",
        "host",
        "--permission-prompt-tool",
        "stdio",
      ],
    }
  `);
});

it('passes the effort a model offers (its default when none was chosen) after the model, and refuses one it does not offer', () => {
  const opus = { kind: 'model', id: 'opus', choices: { effort: 'xhigh' } } as const;
  const effort = effortOf(opus);
  expect({
    effort,
    args: buildInvocation({ access: 'read-only', mode: 'interactive', selection: opus, system: null, seed: null, prompt: 'hi', effort: effort.kind === 'level' ? effort.level : null }).args.slice(-4),
    noChoice: effortOf({ kind: 'model', id: 'opus', choices: {} }),
    providerDefault: effortOf({ kind: 'default' }),
    notOffered: effortOf({ kind: 'model', id: 'haiku', choices: { effort: 'ultra' } }),
    unknownModel: effortOf({ kind: 'model', id: 'claude-mystery', choices: { effort: 'low' } }),
    unknownModelNoChoice: effortOf({ kind: 'model', id: 'claude-mystery', choices: {} }),
  }).toMatchInlineSnapshot(`
    {
      "args": [
        "--model",
        "opus",
        "--effort",
        "xhigh",
      ],
      "effort": {
        "kind": "level",
        "level": "xhigh",
      },
      "noChoice": {
        "kind": "level",
        "level": "high",
      },
      "notOffered": {
        "kind": "unsupported",
        "reason": "Claude model "haiku" does not offer the effort "ultra". Pick another effort.",
      },
      "providerDefault": {
        "kind": "none",
      },
      "unknownModel": {
        "kind": "unsupported",
        "reason": "Claude model "claude-mystery" does not offer the effort "low". Pick another effort.",
      },
      "unknownModelNoChoice": {
        "kind": "none",
      },
    }
  `);
});

it('passes no --effort for a model that reports no efforts, and refuses one asked for it', () => {
  const haiku = { kind: 'model', id: 'claude-haiku-4-5-20251001', choices: {} } as const;
  const effort = effortOf(haiku);
  expect({
    effort,
    args: buildInvocation({ access: 'read-only', mode: 'interactive', selection: haiku, system: null, seed: null, prompt: 'hi', effort: effort.kind === 'level' ? effort.level : null }).args.slice(-2),
    asked: effortOf({ ...haiku, choices: { effort: 'high' } }).kind,
  }).toMatchInlineSnapshot(`
    {
      "args": [
        "--model",
        "claude-haiku-4-5-20251001",
      ],
      "asked": "unsupported",
      "effort": {
        "kind": "none",
      },
    }
  `);
});

