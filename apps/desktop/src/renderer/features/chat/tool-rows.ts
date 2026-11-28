import { z } from 'zod';
import { commandDoing } from './command-kind.ts';
import type { ApprovalStep, ToolStep, TurnStep } from './thread-model.ts';

/** What a tool did, for its glyph and the group summary. */
export type ToolVerb = 'read' | 'edit' | 'write' | 'delete' | 'move' | 'run' | 'search' | 'fetch' | 'think' | 'other';

export interface ToolLine {
  readonly verb: ToolVerb;
  /** One line such as "Read SOUL.md" or "Edited notes/plan.md". */
  readonly text: string;
  /** How many files or calls the row counts as in a group summary. */
  readonly count: number;
  /** The same call while it runs, short enough to sit beside the avatar: "Reading SOUL.md", "Running tests". */
  readonly doing: string;
}

/** How tool text is made safe to show (spec §9.1). */
export interface ToolDisplay {
  readonly path: (path: string) => string;
  readonly redact: (text: string) => string;
}

const text = z.string().optional().catch(undefined);
const ToolFields = z.looseObject({
  file_path: text,
  notebook_path: text,
  path: text,
  command: text,
  pattern: text,
  query: text,
  url: text,
  title: text,
  files: z.array(z.string()).optional().catch(undefined),
});

const MAX_COMMAND = 80;
/** The longest target or query the status beside the avatar names. */
const MAX_SHORT = 32;

const clip = (text: string, max = MAX_SHORT): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** A shown path's last part: "Composer.tsx" from "src/features/chat/Composer.tsx". */
const fileName = (shown: string): string => clip(shown.split('/').findLast((part) => part !== '') ?? shown);

/** A tool call as one quiet line, built from its name and input (the wire carries no output). */
export function describeTool(name: string, input: unknown, display: ToolDisplay): ToolLine {
  const parsed = ToolFields.safeParse(input);
  const fields = parsed.success ? parsed.data : {};
  const title = fields.title === undefined || fields.title === '' ? null : display.redact(fields.title);
  const rawPath = fields.file_path ?? fields.notebook_path ?? fields.path;
  const shownPath = rawPath === undefined || rawPath === '' ? null : display.path(rawPath);
  const target = shownPath ?? title ?? 'a file';
  const short = shownPath === null ? (title === null ? 'a file' : clip(title)) : fileName(shownPath);
  const line = (verb: ToolVerb, said: string, doing: string, count = 1): ToolLine => ({ verb, text: said, count, doing });
  switch (name) {
    case 'Read':
      return line('read', `Read ${target}`, `Reading ${short}`);
    case 'ViewImage':
      return line('read', `Viewed ${target}`, `Viewing ${short}`);
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const files = fields.files ?? [];
      if (files.length > 1) return line('edit', `Edited ${String(files.length)} files`, `Editing ${String(files.length)} files`, files.length);
      const only = files[0] === undefined ? null : display.path(files[0]);
      return line('edit', `Edited ${only ?? target}`, `Editing ${only === null ? short : fileName(only)}`);
    }
    case 'Write':
      return line('write', `Wrote ${target}`, `Writing ${short}`);
    case 'Delete':
      return line('delete', `Deleted ${target}`, `Deleting ${short}`);
    case 'Move':
      return line('move', `Moved ${target}`, `Moving ${short}`);
    case 'Bash':
    case 'Shell': {
      const command = fields.command === undefined ? title : firstLine(display.redact(fields.command));
      const kind = fields.command ?? title;
      return line('run', command === null || command === '' ? 'Ran a command' : `Ran ${command}`, kind === null ? 'Running a command' : commandDoing(kind));
    }
    case 'Grep':
      return fields.pattern === undefined
        ? line('search', 'Searched files', 'Searching files')
        : line('search', `Searched for “${display.redact(fields.pattern)}”`, `Searching for “${clip(display.redact(fields.pattern))}”`);
    case 'Glob':
      return line('search', fields.pattern === undefined ? 'Listed files' : `Listed files matching ${display.redact(fields.pattern)}`, 'Finding files');
    case 'Search':
      return line('search', title === null ? 'Searched files' : `Searched ${title}`, title === null ? 'Searching files' : `Searching ${clip(title)}`);
    case 'WebSearch':
      return fields.query === undefined
        ? line('search', 'Searched the web', 'Searching the web')
        : line('search', `Searched the web for “${display.redact(fields.query)}”`, `Searching the web for “${clip(display.redact(fields.query))}”`);
    case 'WebFetch':
    case 'Fetch': {
      const host = fields.url === undefined ? null : (URL.parse(fields.url)?.host ?? null);
      if (host !== null) return line('fetch', `Fetched ${display.redact(host)}`, `Browsing ${clip(display.redact(host))}`);
      return title === null ? line('fetch', 'Fetched a page', 'Browsing') : line('fetch', `Fetched ${title}`, `Browsing ${clip(title)}`);
    }
    case 'Think':
      return line('think', 'Thought it through', 'Thinking');
    case 'TodoWrite':
      return line('other', 'Updated the to-do list', 'Updating the to-do list');
    case 'Task':
      return line('other', 'Ran a helper agent', 'Running a helper agent');
    default:
      return line('other', title === null ? `Used ${display.redact(name)}` : `Used ${display.redact(name)}: ${title}`, 'Using a tool');
  }
}

function firstLine(command: string): string {
  const first = command.trim().split('\n')[0] ?? '';
  const cut = first.length > MAX_COMMAND ? `${first.slice(0, MAX_COMMAND - 1)}…` : first;
  return command.trim().includes('\n') && !cut.endsWith('…') ? `${cut} …` : cut;
}

/** Each verb's past tense and what it counts; `null` counts nothing ("Thought it through"). */
const PAST: Readonly<Record<ToolVerb, readonly [said: string, noun: string | null]>> = {
  read: ['Read', 'file'],
  edit: ['Edited', 'file'],
  write: ['Wrote', 'file'],
  delete: ['Deleted', 'file'],
  move: ['Moved', 'file'],
  run: ['Ran', 'command'],
  search: ['Searched', 'time'],
  fetch: ['Fetched', 'page'],
  think: ['Thought it through', null],
  other: ['Used', 'tool'],
};

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

function verbCounts(lines: readonly ToolLine[]): [ToolVerb, number][] {
  const counts = new Map<ToolVerb, number>();
  for (const { verb, count } of lines) counts.set(verb, (counts.get(verb) ?? 0) + count);
  return [...counts];
}

/** A collapsed group's one line: "Read 3 files · Edited 1 file", verbs in the order they first ran. */
export function groupSummary(lines: readonly ToolLine[]): string {
  return verbCounts(lines)
    .map(([verb, count]) => {
      const [said, noun] = PAST[verb];
      return noun === null ? said : `${said} ${plural(count, noun)}`;
    })
    .join(' · ');
}

/**
 * A finished turn's tool calls in one lower-case phrase, for beside "Worked for 2m" when tool rows are hidden:
 * "read 4 files, edited 2, ran 5 commands". A noun the phrase before already named is left out. Null with no calls.
 */
export function turnSummary(steps: readonly TurnStep[], display: ToolDisplay): string | null {
  const lines = steps.flatMap((step) => (step.kind === 'tool' ? [describeTool(step.name, step.input, display)] : []));
  let named: string | null = null;
  const phrases = verbCounts(lines).map(([verb, count]) => {
    const [said, noun] = PAST[verb];
    const lower = said.toLowerCase();
    if (noun === null) return lower;
    const shown = noun === named ? `${lower} ${String(count)}` : `${lower} ${plural(count, noun)}`;
    named = noun;
    return shown;
  });
  return phrases.length === 0 ? null : phrases.join(', ');
}

/** A turn's steps as the timeline shows them. */
export type TimelineItem =
  | { readonly kind: 'group'; readonly tools: readonly ToolStep[] }
  | { readonly kind: 'tool'; readonly tool: ToolStep }
  | { readonly kind: 'approval'; readonly step: ApprovalStep };

/**
 * Consecutive successful tool calls collapse into one group (spec §4.2). Running and failed calls,
 * and every approval, stay rows of their own; a lone success is a plain row.
 */
export function groupSteps(steps: readonly TurnStep[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let run: ToolStep[] = [];
  const close = (): void => {
    const [only] = run;
    if (run.length === 1 && only !== undefined) items.push({ kind: 'tool', tool: only });
    else if (run.length > 1) items.push({ kind: 'group', tools: run });
    run = [];
  };
  for (const step of steps) {
    if (step.kind === 'tool' && step.outcome === 'ok') {
      run.push(step);
      continue;
    }
    close();
    items.push(step.kind === 'tool' ? { kind: 'tool', tool: step } : { kind: 'approval', step });
  }
  close();
  return items;
}

/** A client-timed duration: "8s", "2m 8s", "1h 4m". */
export function elapsed(ms: number): string {
  if (ms < 1_000) return '<1s';
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
