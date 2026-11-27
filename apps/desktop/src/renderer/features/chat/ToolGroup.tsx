import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import type { ApprovalStep, ToolStep, TurnStep } from './thread-model.ts';
import { describeTool, elapsed, groupSteps, groupSummary, type ToolDisplay } from './tool-rows.ts';

/** Tool input in details: at most 4 KB, after redaction. The wire carries no tool output. */
const MAX_INPUT_CHARS = 4_096;

const STATUS: Readonly<Record<ToolStep['outcome'], string>> = { running: 'Running', ok: 'Done', error: 'Failed', unfinished: "Didn't finish" };

function Glyph({ outcome }: { readonly outcome: ToolStep['outcome'] }) {
  switch (outcome) {
    case 'running':
      return <span class="tool-glyph pulse" aria-hidden="true" />;
    case 'ok':
      return <span class="tool-glyph ok"><Icon name="check" size={12} /></span>;
    case 'error':
      return <span class="tool-glyph error"><Icon name="warning" size={12} /></span>;
    case 'unfinished':
      return <span class="tool-glyph unfinished" aria-hidden="true" />;
  }
}

function inputText(input: unknown, display: ToolDisplay): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'object' && Object.keys(input).length === 0) return null;
  const json = JSON.stringify(input, null, 2);
  const shown = display.redact(json);
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

/** A turn's tool calls and approval cards, in the order they arrived (spec §4.2). */
export function TurnSteps(props: {
  readonly steps: readonly TurnStep[];
  readonly display: ToolDisplay;
  readonly approval: (step: ApprovalStep) => ComponentChildren;
}) {
  if (props.steps.length === 0) return null;
  return (
    <ul class="steps" aria-label="Activity">
      {groupSteps(props.steps).map((item) => {
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
