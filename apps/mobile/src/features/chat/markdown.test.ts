import { expect, it } from 'vitest';
import { parseMarkdown } from './markdown.ts';

it('splits a reply into headings, lists, quotes, code and inline runs', () => {
  const source = ['## Day 1', '- See **the castle**', '- Ride `tram 28`', '', '1. One', '2. *Two*', '', '> A note', '', '```json', '{ "days": 3 }', '```', 'Done.'].join('\n');
  expect(parseMarkdown(source)).toMatchInlineSnapshot(`
    [
      {
        "inline": [
          {
            "kind": "text",
            "text": "Day 1",
          },
        ],
        "kind": "heading",
        "level": 2,
      },
      {
        "items": [
          [
            {
              "kind": "text",
              "text": "See ",
            },
            {
              "kind": "strong",
              "text": "the castle",
            },
          ],
          [
            {
              "kind": "text",
              "text": "Ride ",
            },
            {
              "kind": "code",
              "text": "tram 28",
            },
          ],
        ],
        "kind": "list",
        "ordered": false,
      },
      {
        "items": [
          [
            {
              "kind": "text",
              "text": "One",
            },
          ],
          [
            {
              "kind": "em",
              "text": "Two",
            },
          ],
        ],
        "kind": "list",
        "ordered": true,
      },
      {
        "inline": [
          {
            "kind": "text",
            "text": "A note",
          },
        ],
        "kind": "quote",
      },
      {
        "kind": "code",
        "language": "json",
        "open": false,
        "text": "{ "days": 3 }",
      },
      {
        "inline": [
          {
            "kind": "text",
            "text": "Done.",
          },
        ],
        "kind": "paragraph",
      },
    ]
  `);
});

it('treats a fence still streaming in as an open code block', () => {
  expect(parseMarkdown('Here:\n```ts\nconst a = 1;')).toEqual([
    { kind: 'paragraph', inline: [{ kind: 'text', text: 'Here:' }] },
    { kind: 'code', language: 'ts', text: 'const a = 1;', open: true },
  ]);
});
