import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import { parseMarkdown, plainText, safeHref } from './markdown.ts';
import { Markdown } from './Markdown.tsx';

const NO_ACTIONS = { openLink: () => undefined, copy: () => undefined };
const html = (text: string): string => renderToString(h(Markdown, { text, actions: NO_ACTIONS }));

it('renders the subset: headings, paragraphs with line breaks, lists, bold, italic, code and links', () => {
  const reply = [
    '## Grocery plan',
    'Buy **oat milk** and *bread*,',
    'then check `notes/plan.md`.',
    '',
    '1. Eggs',
    '2. Apples',
    '   - green',
    '- Ask at [the shop](https://example.com/hours).',
    '',
    '```ts',
    'const total = 3 * 4;',
    '```',
  ].join('\n');
  expect(html(reply)).toMatchInlineSnapshot(`"<div data-find-text class="md"><p role="heading" aria-level="2" class="md-heading level-2">Grocery plan</p><p>Buy <strong>oat milk</strong> and <em>bread</em>,<br/>then check <code>notes/plan.md</code>.</p><ol start="1"><li><p>Eggs</p></li><li><p>Apples</p><ul><li><p>green</p></li></ul></li></ol><ul><li><p>Ask at <a href="https://example.com/hours" title="https://example.com/hours" rel="noreferrer noopener">the shop</a>.</p></li></ul><div class="md-code"><div data-find-skip class="md-code-head"><span>ts</span><button aria-label="Copy ts code" class="ghost">Copy</button></div><pre><code>const total = 3 * 4;</code></pre></div></div>"`);
});

/** Every element and attribute Markdown can render; anything else came from the reply. */
const TAGS = new Set(['div', 'p', 'strong', 'em', 'code', 'pre', 'br', 'ol', 'ul', 'li', 'a', 'span', 'button']);
const ATTRIBUTES = new Set(['class', 'data-find-text', 'data-find-skip', 'role', 'aria-level', 'aria-label', 'href', 'title', 'rel', 'start']);

function elementsOf(out: string): { readonly tag: string; readonly attributes: string[]; readonly href: string | null }[] {
  return [...out.matchAll(/<(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g)].map(([, tag = '', rest = '']) => ({
    tag,
    attributes: [...rest.matchAll(/([\w-]+)(?:="[^"]*")?/g)].map(([, name = '']) => name),
    href: /href="([^"]*)"/.exec(rest)?.[1] ?? null,
  }));
}

/** Each payload renders as text: no element, attribute or URL from the reply reaches the DOM. */
const XSS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">click</a>',
  '[click](javascript:alert(1))',
  '[click](JAVASCRIPT:alert(1))',
  '[click](  javascript:alert(1))',
  '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[click](vbscript:msgbox(1))',
  '[click](file:///etc/passwd)',
  '[click](//evil.example/x)',
  '<svg onload=alert(1)>',
  '<iframe src="https://evil.example"></iframe>',
  '<style>body{display:none}</style>',
  '**<b onmouseover=alert(1)>bold</b>**',
  '`<script>alert(1)</script>`',
  '```html\n<script>alert(1)</script>\n```',
  '[x](https://example.com/" onclick="alert(1))',
  '<https://example.com/"><script>alert(1)</script>>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
];

it('renders no HTML from a reply: every XSS fixture stays text', () => {
  for (const payload of XSS) {
    const elements = elementsOf(html(payload));
    expect(elements.filter(({ tag }) => !TAGS.has(tag)), payload).toEqual([]);
    expect(elements.flatMap(({ attributes }) => attributes.filter((name) => !ATTRIBUTES.has(name))), payload).toEqual([]);
    expect(elements.flatMap(({ href }) => (href === null || safeHref(href) === href ? [] : [href])), payload).toEqual([]);
  }
  expect(XSS.slice(0, 5).map(html)).toMatchInlineSnapshot(`
    [
      "<div data-find-text class="md"><p>&lt;script>alert(1)&lt;/script></p></div>",
      "<div data-find-text class="md"><p>&lt;img src=x onerror=alert(1)></p></div>",
      "<div data-find-text class="md"><p>&lt;a href=&quot;javascript:alert(1)&quot;>click&lt;/a></p></div>",
      "<div data-find-text class="md"><p>[click](javascript:alert(1))</p></div>",
      "<div data-find-text class="md"><p>[click](JAVASCRIPT:alert(1))</p></div>",
    ]
  `);
});

it('makes links only of absolute http(s) URLs, and trims punctuation off bare ones', () => {
  expect({
    hrefs: ['https://example.com/a', 'HTTP://Example.com', 'mailto:sam@example.com', 'ftp://example.com', '/relative', 'javascript:alert(1)'].map(safeHref),
    bare: html('See https://example.com/docs). And <https://example.com/x>, not foohttps://evil.example.'),
  }).toMatchInlineSnapshot(`
    {
      "bare": "<div data-find-text class="md"><p>See <a href="https://example.com/docs" title="https://example.com/docs" rel="noreferrer noopener">https://example.com/docs</a>). And <a href="https://example.com/x" title="https://example.com/x" rel="noreferrer noopener">https://example.com/x</a>, not foohttps://evil.example.</p></div>",
      "hrefs": [
        "https://example.com/a",
        "http://example.com/",
        null,
        null,
        null,
        null,
      ],
    }
  `);
});

it('keeps intraword underscores, unclosed markers and an unclosed fence (mid-stream) as written', () => {
  expect(plainText(parseMarkdown('snake_case_name and 2 * 3 * 4 and **open and `tick\n```py\nprint(1)'))).toMatchInlineSnapshot(`"snake_case_name and 2 * 3 * 4 and **open and \`tickprint(1)"`);
});

it('parses a long, hostile reply in linear time', () => {
  const hostile = ['*a '.repeat(40_000), `a ${'_'.repeat(40_000)}`, `a ${'`a'.repeat(20_000)}`, '[a]('.repeat(20_000), '** '.repeat(40_000)].join('\n\n');
  const started = performance.now();
  const blocks = parseMarkdown(hostile);
  const ms = performance.now() - started;
  expect(blocks.length).toBe(5);
  expect(ms).toBeLessThan(1_500);
});
