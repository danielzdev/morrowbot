/**
 * Ori Bot's own Markdown subset (spec §4.1): paragraphs, headings, lists, bold, italic, inline
 * code, fenced code and http(s) links. It parses to plain data; there is no HTML node, so raw HTML
 * in a reply is only ever text.
 */
export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'em'; readonly children: readonly Inline[] }
  /** `href` is always an absolute http or https URL. */
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] }
  | { readonly kind: 'break' };

export type Block =
  | { readonly kind: 'paragraph'; readonly inlines: readonly Inline[] }
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly inlines: readonly Inline[] }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly (readonly Block[])[] }
  | { readonly kind: 'code'; readonly lang: string | null; readonly text: string };

const MAX_LIST_DEPTH = 8;
const MAX_EMPHASIS_DEPTH = 16;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const LANG = /^[\w+#.-]{1,24}$/;
const PUNCTUATION = /[!-/:-@[-`{-~]/;
const AUTOLINK = /https?:\/\/[^\s<>]+/iy;

/** Only an absolute http(s) URL becomes a link; anything else stays text. */
export function safeHref(raw: string): string | null {
  const url = URL.parse(raw.trim());
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
}

export function parseMarkdown(text: string): Block[] {
  return blocksOf(text.replace(/\r\n?/g, '\n').split('\n'), 0);
}

const isBlank = (line: string): boolean => line.trim() === '';
const startsBlock = (line: string): boolean => FENCE.test(line) || HEADING.test(line) || ITEM.test(line);

function blocksOf(lines: readonly string[], depth: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null && !(fence[1]?.startsWith('`') === true && fence[2]?.includes('`') === true)) {
      const marker = fence[1] ?? '```';
      const info = (fence[2] ?? '').trim().split(/\s+/)[0] ?? '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !isClosingFence(lines[i] ?? '', marker)) body.push(lines[i++] ?? '');
      i += 1;
      blocks.push({ kind: 'code', lang: LANG.test(info) ? info : null, text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: levelOf(heading[1]?.length ?? 1), inlines: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }
    if (ITEM.test(line) && depth < MAX_LIST_DEPTH) {
      const list = listAt(lines, i, depth);
      blocks.push(list.block);
      i = list.next;
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && !isBlank(lines[i] ?? '') && (paragraph.length === 0 || !startsBlock(lines[i] ?? ''))) {
      paragraph.push((lines[i++] ?? '').trim());
    }
    blocks.push({ kind: 'paragraph', inlines: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

function isClosingFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= marker.length && /^(`+|~+)$/.test(trimmed) && trimmed.startsWith(marker);
}

function levelOf(count: number): 1 | 2 | 3 | 4 | 5 | 6 {
  switch (count) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return count;
    default:
      return 6;
  }
}

/** A list starting at `start`: items at one indent, each item's indented lines parsed as blocks. */
function listAt(lines: readonly string[], start: number, depth: number): { readonly block: Block; readonly next: number } {
  const first = ITEM.exec(lines[start] ?? '');
  const ordered = /\d/.test(first?.[2] ?? '');
  const items: string[][] = [];
  let i = start;
  let indent = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const item = ITEM.exec(line);
    if (item !== null && (item[1]?.length ?? 0) < indent + 2 && /\d/.test(item[2] ?? '') === ordered) {
      indent = (item[1]?.length ?? 0) + (item[2]?.length ?? 1) + 1;
      items.push([item[3] ?? '']);
      i += 1;
      continue;
    }
    const current = items.at(-1);
    if (current === undefined) break;
    if (isBlank(line)) {
      let next = i + 1;
      while (next < lines.length && isBlank(lines[next] ?? '')) next += 1;
      const after = lines[next];
      const sameList = after !== undefined && ITEM.test(after) && /\d/.test(ITEM.exec(after)?.[2] ?? '') === ordered && leading(after) < indent;
      if (after === undefined || (!sameList && leading(after) < indent)) break;
      for (; i < next; i += 1) current.push('');
      continue;
    }
    if (leading(line) >= indent) current.push(line.slice(indent));
    else if (current.at(-1) !== '' && !startsBlock(line)) current.push(line.trim());
    else break;
    i += 1;
  }
  const number = Number.parseInt(first?.[2] ?? '1', 10);
  return {
    block: { kind: 'list', ordered, start: Number.isFinite(number) ? number : 1, items: items.map((item) => blocksOf(item, depth + 1)) },
    next: i,
  };
}

const leading = (line: string): number => line.length - line.trimStart().length;

/** An open `*`/`_` run waiting for its closer, with what came after it. */
interface Frame {
  readonly char: string;
  count: number;
  readonly children: Inline[];
}

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);
const isWord = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/** Inline nodes of `source`. Inside a link's label (`inLink`), nothing becomes another link. */
export function parseInline(source: string, inLink = false): Inline[] {
  const root: Frame = { char: '', count: 0, children: [] };
  const stack: Frame[] = [root];
  const noCloser = new Map<number, number>();
  let buffer = '';
  const top = (): Frame => stack.at(-1) ?? root;
  const flush = (): void => {
    if (buffer !== '') top().children.push({ kind: 'text', text: buffer });
    buffer = '';
  };
  const push = (node: Inline): void => {
    flush();
    top().children.push(node);
  };
  /** Pops the top frame as plain text: its delimiters and children go back to the frame below. */
  const unwind = (): void => {
    flush();
    const frame = stack.pop();
    if (frame === undefined) return;
    const below = top().children;
    below.push({ kind: 'text', text: frame.char.repeat(frame.count) });
    for (const child of frame.children) below.push(child);
  };
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    if (char === '\\' && PUNCTUATION.test(source.charAt(i + 1))) {
      buffer += source.charAt(i + 1);
      i += 2;
    } else if (char === '\n') {
      push({ kind: 'break' });
      i += 1;
    } else if (char === '`') {
      const run = runLength(source, i, '`');
      const close = (noCloser.get(run) ?? Infinity) <= i ? -1 : closingRun(source, i + run, run);
      if (close === -1) {
        noCloser.set(run, i);
        buffer += '`'.repeat(run);
        i += run;
      } else {
        const inner = source.slice(i + run, close).replaceAll('\n', ' ');
        push({ kind: 'code', text: inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') ? inner.slice(1, -1) : inner });
        i = close + run;
      }
    } else if (char === '[' && !inLink) {
      const link = linkAt(source, i);
      if (link === null) {
        buffer += char;
        i += 1;
      } else if (link.href === null) {
        buffer += link.label;
        i = link.end;
      } else {
        push({ kind: 'link', href: link.href, children: parseInline(link.label, true) });
        i = link.end;
      }
    } else if (!inLink && (char === 'h' || char === 'H' || char === '<') && autolinkAt(source, i) !== null) {
      const auto = autolinkAt(source, i);
      if (auto !== null) {
        push({ kind: 'link', href: auto.href, children: [{ kind: 'text', text: auto.text }] });
        i = auto.end;
      }
    } else if (char === '*' || char === '_') {
      const count = runLength(source, i, char);
      const before = source.charAt(i - 1) || undefined;
      const after = source.charAt(i + count) || undefined;
      const canOpen = !isSpace(after) && (char === '*' || !isWord(before));
      const canClose = !isSpace(before) && (char === '*' || !isWord(after));
      let left = count;
      while (left > 0 && canClose) {
        const at = stack.findLastIndex((frame, index) => index > 0 && frame.char === char);
        if (at === -1) break;
        while (stack.length - 1 > at) unwind();
        flush();
        const opener = top();
        const use = left >= 2 && opener.count >= 2 ? 2 : 1;
        const node: Inline = use === 2 ? { kind: 'strong', children: opener.children } : { kind: 'em', children: opener.children };
        stack.pop();
        const parent = top().children;
        if (opener.count > use) parent.push({ kind: 'text', text: char.repeat(opener.count - use) });
        parent.push(node);
        left -= use;
      }
      if (left > 0 && canOpen && stack.length <= MAX_EMPHASIS_DEPTH) {
        flush();
        stack.push({ char, count: left, children: [] });
      } else if (left > 0) {
        buffer += char.repeat(left);
      }
      i += count;
    } else {
      buffer += char;
      i += 1;
    }
  }
  while (stack.length > 1) unwind();
  flush();
  return merged(root.children);
}

function runLength(source: string, at: number, char: string): number {
  let end = at;
  while (source.charAt(end) === char) end += 1;
  return end - at;
}

/** Where the next run of exactly `length` backticks starts, or -1. */
function closingRun(source: string, from: number, length: number): number {
  let at = source.indexOf('`', from);
  while (at !== -1) {
    const run = runLength(source, at, '`');
    if (run === length) return at;
    at = source.indexOf('`', at + run);
  }
  return -1;
}

/** `[label](url)` at `at`: the label, its http(s) URL or null for any other scheme, and where it ends. */
function linkAt(source: string, at: number): { readonly label: string; readonly href: string | null; readonly end: number } | null {
  let depth = 0;
  let close = -1;
  for (let i = at; i < Math.min(source.length, at + 1_000); i += 1) {
    const char = source.charAt(i);
    if (char === '\\') i += 1;
    else if (char === '[') depth += 1;
    else if (char === ']' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1 || source.charAt(close + 1) !== '(') return null;
  const target = /^\(\s*<?([^\s<>()]*)>?(?:\s+"[^"]*")?\s*\)/.exec(source.slice(close + 1, close + 2_050));
  if (target === null) return null;
  return { label: source.slice(at + 1, close), href: safeHref(target[1] ?? ''), end: close + 1 + target[0].length };
}

/** A bare or `<…>` http(s) URL at `at`, without trailing punctuation. */
function autolinkAt(source: string, at: number): { readonly href: string; readonly text: string; readonly end: number } | null {
  const angled = source.charAt(at) === '<';
  if (!angled && isWord(source.charAt(at - 1) || undefined)) return null;
  AUTOLINK.lastIndex = angled ? at + 1 : at;
  const match = AUTOLINK.exec(source);
  if (match === null) return null;
  let text = match[0];
  if (angled) {
    const close = text.indexOf('>');
    if (close === -1 && source.charAt(at + 1 + text.length) !== '>') return null;
    text = close === -1 ? text : text.slice(0, close);
  } else {
    while (/[.,:;!?'"*_]$/.test(text) || (text.endsWith(')') && !text.includes('('))) text = text.slice(0, -1);
  }
  const href = safeHref(text);
  return href === null ? null : { href, text, end: at + (angled ? text.length + 2 : text.length) };
}

/** Adjacent text nodes joined, so the tree stays small. */
function merged(nodes: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (node.kind === 'text' && node.text === '') continue;
    if (node.kind === 'text' && last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + node.text };
    else out.push(node);
  }
  return out;
}

/** The text a reader sees, in DOM order with nothing between nodes: what FindBar searches. */
export function plainText(blocks: readonly Block[]): string {
  return blocks.map(blockText).join('');
}

function blockText(block: Block): string {
  switch (block.kind) {
    case 'paragraph':
    case 'heading':
      return inlineText(block.inlines);
    case 'list':
      return block.items.map(plainText).join('');
    case 'code':
      return block.text;
  }
}

function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
        case 'code':
          return node.text;
        case 'strong':
        case 'em':
        case 'link':
          return inlineText(node.children);
        case 'break':
          return '';
      }
    })
    .join('');
}
