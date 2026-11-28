/** A run of inline text. Nesting is not kept: `**a *b***` is one strong run. */
export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'em'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string };

/** The markdown the chat draws. `open`: a code fence still streaming in. */
export type Block =
  | { readonly kind: 'paragraph'; readonly inline: readonly Inline[] }
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3; readonly inline: readonly Inline[] }
  | { readonly kind: 'quote'; readonly inline: readonly Inline[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
  | { readonly kind: 'code'; readonly language: string; readonly text: string; readonly open: boolean };

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;

/** Inline code, bold and italics; everything else is plain text. */
export function parseInline(text: string): Inline[] {
  const runs: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) runs.push({ kind: 'text', text: text.slice(at, match.index) });
    const [, , code, strong, strongAlt, em, emAlt] = match;
    if (code !== undefined) runs.push({ kind: 'code', text: code.trim() === '' ? code : code.trim() });
    else if (strong !== undefined || strongAlt !== undefined) runs.push({ kind: 'strong', text: strong ?? strongAlt ?? '' });
    else runs.push({ kind: 'em', text: em ?? emAlt ?? '' });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ kind: 'text', text: text.slice(at) });
  return runs;
}

function headingLevel(hashes: string): 1 | 2 | 3 {
  if (hashes.length === 1) return 1;
  return hashes.length === 2 ? 2 : 3;
}

/** Splits a reply into blocks. Safe on partial text: an unclosed fence is an open code block. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  const building: { list: { ordered: boolean; items: Inline[][] } | null } = { list: null };
  let quote: string[] = [];

  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) });
    if (building.list !== null) blocks.push({ kind: 'list', ordered: building.list.ordered, items: building.list.items });
    if (quote.length > 0) blocks.push({ kind: 'quote', inline: parseInline(quote.join(' ')) });
    paragraph = [];
    building.list = null;
    quote = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1] ?? '```';
      const body: string[] = [];
      let closed = false;
      for (index++; index < lines.length; index++) {
        const inner = lines[index] ?? '';
        if (inner.trim().startsWith(marker)) {
          closed = true;
          break;
        }
        body.push(inner);
      }
      blocks.push({ kind: 'code', language: fence[2] ?? '', text: body.join('\n'), open: !closed });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: headingLevel(heading[1] ?? '#'), inline: parseInline(heading[2] ?? '') });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = numbered !== null;
      if (building.list?.ordered !== ordered) flush();
      building.list ??= { ordered, items: [] };
      building.list.items.push(parseInline(item[1] ?? ''));
      continue;
    }
    const quoted = QUOTE.exec(line);
    if (quoted) {
      if (quote.length === 0) flush();
      quote.push(quoted[1] ?? '');
      continue;
    }
    if (building.list !== null || quote.length > 0) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
