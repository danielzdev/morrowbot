import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import type { ApprovalStep, ToolStep, TurnStep } from './thread-model.ts';
import { describeTool, elapsed, groupSteps, groupSummary, type ToolDisplay } from './tool-rows.ts';

/** Tool input in details: at most 4 KB, after redaction. The wire carries no tool output. */
const MAX_INPUT_CHARS = 4_096;

const STATUS: Readonly<Record<ToolStep['outcome'], string>> = { running: 'Running', ok: 'Done', error: 'Failed', unfinished: "Didn't finish", unknown: 'Result unknown' };

function Glyph({ outcome }: { readonly outcome: ToolStep['outcome'] }) {
  switch (outcome) {
    case 'running':
      return <span class="tool-glyph pulse" aria-hidden="true" />;
    case 'ok':
      return <span class="tool-glyph ok"><Icon name="check" size={12} /></span>;
    case 'error':
      return <span class="tool-glyph error"><Icon name="warning" size={12} /></span>;
    case 'unfinished':
    case 'unknown':
      return <span class="tool-glyph unfinished" aria-hidden="true" />;
  }
}

/** Fields whose strings are paths: they follow the §9.1 path rule, like the row's summary. */
const PATH_FIELDS = new Set(['file_path', 'notebook_path', 'path', 'files', 'cwd']);
const MAX_INPUT_DEPTH = 8;

/** The input made safe value by value, before it is serialized, so escaping can't hide a home path from redaction. */
function safeInput(value: unknown, display: ToolDisplay, isPath: boolean, depth: number): unknown {
  if (typeof value === 'string') return isPath ? display.path(value) : display.redact(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_INPUT_DEPTH) return '…';
  if (Array.isArray(value)) return value.map((each) => safeInput(each, display, isPath, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [display.redact(key), safeInput(each, display, PATH_FIELDS.has(key), depth + 1)]));
}

function inputText(input: unknown, display: ToolDisplay): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'object' && Object.keys(input).length === 0) return null;
  const shown = JSON.stringify(safeInput(input, display, false, 0), null, 2);
  return shown.length > MAX_INPUT_CHARS ? `${shown.slice(0, MAX_INPUT_CHARS - 1)}…` : shown;
}

/** An open row: status, client-timed duration and, behind Show details, the redacted input. The wire carries no output. */
export function ToolDetails(props: { readonly tool: ToolStep; readonly display: ToolDisplay; readonly showInput: boolean; readonly onToggleInput: () => void }) {
  const { tool } = props;
  const input = inputText(tool.input, props.display);
  return (
    <div class="tool-details">
      <div class="tool-meta">
        {STATUS[tool.outcome]}
        {tool.endedAt !== null && ` · ${elapsed(tool.endedAt - tool.startedAt)}`}
      </div>
      {input !== null && (
        <button class="ghost tool-more" aria-expanded={props.showInput} onClick={props.onToggleInput}>
          {props.showInput ? 'Hide details' : 'Show details'}
        </button>
      )}
      {props.showInput && input !== null && <pre class="tool-input" data-find-skip="">{input}</pre>}
    </div>
  );
}

/** One tool call. Enter or click expands it in place. */
export function ToolRow(props: { readonly tool: ToolStep; readonly display: ToolDisplay }) {
  const { tool, display } = props;
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const line = describeTool(tool.name, tool.input, display);
  return (
    <li class={`tool-row ${tool.outcome}`}>
      <button class="tool-line" aria-expanded={open} onClick={() => { setOpen(!open); }}>
        <Glyph outcome={tool.outcome} />
        <span class="tool-text">{line.text}</span>
        {tool.outcome === 'ok' ? <span class="visually-hidden">, {STATUS.ok}</span> : <span class="tool-status">{STATUS[tool.outcome]}</span>}
      </button>
      {open && <ToolDetails tool={tool} display={display} showInput={details} onToggleInput={() => { setDetails(!details); }} />}
    </li>
  );
}

/** Consecutive successful calls as one summary row, collapsed until opened. */
export function ToolGroup(props: { readonly tools: readonly ToolStep[]; readonly display: ToolDisplay }) {
  const [open, setOpen] = useState(false);
  const summary = groupSummary(props.tools.map((tool) => describeTool(tool.name, tool.input, props.display)));
  return (
    <li class="tool-group">
      <button class="tool-line" aria-expanded={open} onClick={() => { setOpen(!open); }}>
        <span class="tool-glyph ok"><Icon name="check" size={12} /></span>
        <span class="tool-text">{summary}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {open && (
        <ul class="tool-rows">
          {props.tools.map((tool) => <ToolRow key={tool.toolUseId} tool={tool} display={props.display} />)}
        </ul>
      )}
    </li>
  );
}

/** A turn's tool calls and approval cards, in the order they arrived (spec §4.2). Hidden tool calls leave the approvals: only the user can answer them. */
export function TurnSteps(props: {
  readonly steps: readonly TurnStep[];
  /** Show the tool calls, not just the approvals. */
  readonly tools: boolean;
  readonly display: ToolDisplay;
  readonly approval: (step: ApprovalStep) => ComponentChildren;
}) {
  const steps = props.tools ? props.steps : props.steps.filter((step) => step.kind === 'approval');
  if (steps.length === 0) return null;
  return (
    <ul class="steps" aria-label="Activity">
      {groupSteps(steps).map((item) => {
        switch (item.kind) {
          case 'group':
            return <ToolGroup key={item.tools[0]?.toolUseId} tools={item.tools} display={props.display} />;
          case 'tool':
            return <ToolRow key={item.tool.toolUseId} tool={item.tool} display={props.display} />;
          case 'approval':
            return <li key={item.step.approval.approvalId} class="step-approval">{props.approval(item.step)}</li>;
        }
      })}
    </ul>
  );
}
