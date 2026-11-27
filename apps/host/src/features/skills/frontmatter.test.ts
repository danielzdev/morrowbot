import { expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter.ts';

const fields = (source: string): unknown => {
  const parsed = parseFrontmatter(source);
  return parsed.kind === 'ok' ? Object.fromEntries(parsed.fields) : parsed;
};

it('reads plain, quoted, block and continued values, and skips comments and nested keys', () => {
  expect(
    fields(
      [
        '﻿---',
        '# a comment',
        'name: "release-notes"  # trailing comment',
        "title: 'It''s quoted'",
        'description: Writes release notes',
        '  from the merged pull requests.',
        'steps: |',
        '  1. Read the log',
        '  2. Write it up',
        'metadata:',
        '  owner: docs',
        '---',
        'Body text is not read.',
      ].join('\r\n'),
    ),
  ).toMatchInlineSnapshot(`
    {
      "description": "Writes release notes from the merged pull requests.",
      "metadata": "owner: docs",
      "name": "release-notes",
      "steps": "1. Read the log
    2. Write it up",
      "title": "It's quoted",
    }
  `);
});

it('says why a frontmatter block cannot be read', () => {
  expect([fields('# Title\n'), fields('---\nname: open\n'), fields('---\nname: "unclosed\n---\n'), fields('---\n- a list\n---\n')]).toMatchInlineSnapshot(`
    [
      {
        "kind": "invalid",
        "reason": "SKILL.md does not start with a --- frontmatter block.",
      },
      {
        "kind": "invalid",
        "reason": "The frontmatter block is not closed with ---.",
      },
      {
        "kind": "invalid",
        "reason": "The value of "name" has an unclosed quote.",
      },
      {
        "kind": "invalid",
        "reason": "This frontmatter line is not "key: value": - a list",
      },
    ]
  `);
});
