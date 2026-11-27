/** A `SKILL.md`'s frontmatter as plain text fields, or why it could not be read. */
export type Frontmatter = { readonly kind: 'ok'; readonly fields: ReadonlyMap<string, string> } | { readonly kind: 'invalid'; readonly reason: string };

const KEY = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/;
const BLOCK = /^([|>])[+-]?\s*(?:#.*)?$/;

/**
 * Reads the top-level `key: value` lines of a YAML frontmatter block: plain, quoted and `|` / `>`
 * block values, and plain values continued on indented lines. Nested values are read as text.
 */
export function parseFrontmatter(source: string): Frontmatter {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { kind: 'invalid', reason: 'SKILL.md does not start with a --- frontmatter block.' };
  const end = lines.findIndex((line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'));
  if (end === -1) return { kind: 'invalid', reason: 'The frontmatter block is not closed with ---.' };
  const fields = new Map<string, string>();
  const body = lines.slice(1, end);
  let index = 0;
  while (index < body.length) {
    const line = body[index] ?? '';
    index += 1;
    if (line.trim() === '' || line.trimStart().startsWith('#') || /^\s/.test(line)) continue;
    const match = KEY.exec(line);
    if (match === null) return { kind: 'invalid', reason: `This frontmatter line is not "key: value": ${line.slice(0, 80)}` };
    const key = match[1] ?? '';
    const raw = (match[2] ?? '').trim();
    const continued: string[] = [];
    while (index < body.length && (/^\s/.test(body[index] ?? '') || (body[index] ?? '').trim() === '')) {
      continued.push(body[index] ?? '');
      index += 1;
    }
    const value = valueOf(raw, continued);
    if (value === undefined) return { kind: 'invalid', reason: `The value of "${key}" has an unclosed quote.` };
    fields.set(key, value);
  }
  return { kind: 'ok', fields };
}

function valueOf(raw: string, continued: readonly string[]): string | undefined {
  const block = BLOCK.exec(raw);
  if (block !== null) {
    const kept = trimBlank(continued);
    const indent = Math.min(...kept.filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length));
    const text = kept.map((line) => line.slice(indent).trimEnd());
    return block[1] === '|' ? text.join('\n') : fold(text);
  }
  const rest = trimBlank(continued).map((line) => line.trim());
  if (raw.startsWith('"') || raw.startsWith("'")) return quoted([raw, ...rest].join(' '));
  return fold([stripComment(raw), ...rest]);
}

function quoted(text: string): string | undefined {
  const quote = text[0];
  if (quote === "'") {
    const match = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(text);
    return match === null ? undefined : (match[1] ?? '').replaceAll("''", "'");
  }
  const match = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(text);
  if (match === null) return undefined;
  return (match[1] ?? '').replace(/\\(.)/g, (_, char: string) => (char === 'n' ? '\n' : char === 't' ? '\t' : char));
}

const stripComment = (text: string): string => text.replace(/\s+#.*$/, '');

/** Joins lines with spaces; a blank line becomes a line break. */
function fold(lines: readonly string[]): string {
  return lines
    .join('\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim()).filter((line) => line !== '').join(' '))
    .join('\n')
    .trim();
}

function trimBlank(lines: readonly string[]): string[] {
  const kept = [...lines];
  while (kept.length > 0 && (kept.at(-1) ?? '').trim() === '') kept.pop();
  return kept;
}
