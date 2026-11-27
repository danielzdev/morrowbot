import { z } from 'zod';
import type { ApprovalStep, ToolStep, TurnStep } from './thread-model.ts';

/** What a tool did, for its glyph and the group summary. */
export type ToolVerb = 'read' | 'edit' | 'write' | 'delete' | 'move' | 'run' | 'search' | 'fetch' | 'think' | 'other';

export interface ToolLine {
  readonly verb: ToolVerb;
  /** One line such as "Read AGENTS.md" or "Edited notes/plan.md". */
  readonly text: string;
  /** How many files or calls the row counts as in a group summary. */
  readonly count: number;
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

/** A tool call as one quiet line, built from its name and input (the wire carries no output). */
export function describeTool(name: string, input: unknown, display: ToolDisplay): ToolLine {
  const parsed = ToolFields.safeParse(input);
  const fields = parsed.success ? parsed.data : {};
  const title = fields.title === undefined || fields.title === '' ? null : display.redact(fields.title);
  const rawPath = fields.file_path ?? fields.notebook_path ?? fields.path;
  const target = rawPath === undefined || rawPath === '' ? (title ?? 'a file') : display.path(rawPath);
  const line = (verb: ToolVerb, said: string, count = 1): ToolLine => ({ verb, text: said, count });
  switch (name) {
    case 'Read':
      return line('read', `Read ${target}`);
    case 'ViewImage':
      return line('read', `Viewed ${target}`);
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const files = fields.files ?? [];
      if (files.length > 1) return line('edit', `Edited ${String(files.length)} files`, files.length);
      return line('edit', `Edited ${files[0] === undefined ? target : display.path(files[0])}`);
    }
    case 'Write':
      return line('write', `Wrote ${target}`);
    case 'Delete':
      return line('delete', `Deleted ${target}`);
    case 'Move':
      return line('move', `Moved ${target}`);
    case 'Bash':
    case 'Shell': {
      const command = fields.command === undefined ? title : display.redact(firstLine(fields.command));
      return line('run', command === null || command === '' ? 'Ran a command' : `Ran ${command}`);
    }
    case 'Grep':
      return line('search', fields.pattern === undefined ? 'Searched files' : `Searched for “${display.redact(fields.pattern)}”`);
    case 'Glob':
      return line('search', fields.pattern === undefined ? 'Listed files' : `Listed files matching ${display.redact(fields.pattern)}`);
    case 'Search':
      return line('search', title === null ? 'Searched files' : `Searched ${title}`);
    case 'WebSearch':
      return line('search', fields.query === undefined ? 'Searched the web' : `Searched the web for “${display.redact(fields.query)}”`);
    case 'WebFetch':
    case 'Fetch': {
      const host = fields.url === undefined ? null : (URL.parse(fields.url)?.host ?? null);
      return line('fetch', host === null ? (title === null ? 'Fetched a page' : `Fetched ${title}`) : `Fetched ${host}`);
    }
    case 'Think':
      return line('think', 'Thought it through');
    case 'TodoWrite':
      return line('other', 'Updated the to-do list');
    case 'Task':
      return line('other', 'Ran a helper agent');
    default:
      return line('other', title === null ? `Used ${display.redact(name)}` : `Used ${display.redact(name)}: ${title}`);
  }
}

function firstLine(command: string): string {
  const first = command.trim().split('\n')[0] ?? '';
  const cut = first.length > MAX_COMMAND ? `${first.slice(0, MAX_COMMAND - 1)}…` : first;
  return command.trim().includes('\n') && !cut.endsWith('…') ? `${cut} …` : cut;
}

const PHRASES: Readonly<Record<ToolVerb, (count: number) => string>> = {
  read: (n) => `Read ${plural(n, 'file')}`,
  edit: (n) => `Edited ${plural(n, 'file')}`,
  write: (n) => `Wrote ${plural(n, 'file')}`,
  delete: (n) => `Deleted ${plural(n, 'file')}`,
  move: (n) => `Moved ${plural(n, 'file')}`,
  run: (n) => `Ran ${plural(n, 'command')}`,
  search: (n) => `Searched ${plural(n, 'time')}`,
  fetch: (n) => `Fetched ${plural(n, 'page')}`,
  think: () => 'Thought it through',
  other: (n) => `Used ${plural(n, 'tool')}`,
};

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

/** A collapsed group's one line: "Read 3 files · Edited 1 file", verbs in the order they first ran. */
export function groupSummary(lines: readonly ToolLine[]): string {
  const counts = new Map<ToolVerb, number>();
  for (const { verb, count } of lines) counts.set(verb, (counts.get(verb) ?? 0) + count);
  return [...counts].map(([verb, count]) => PHRASES[verb](count)).join(' · ');
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
