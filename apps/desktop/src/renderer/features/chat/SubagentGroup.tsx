import type { BoundProvider, SubagentRun } from '@morrowbot/contracts';
import { useId, useState } from 'preact/hooks';
import { profileName } from '../../shared/binding-ui/access-copy.ts';
import { messageTime } from '../../shared/format.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Markdown, type MarkdownActions } from './Markdown.tsx';
import { replyNote, runStatus, summarizeRuns } from './subagent-cards.ts';

/** The provider and model a sub-agent runs on, as a short badge ("Codex · GPT-5.5 · High"). */
export type EngineLabel = (binding: BoundProvider) => string;

function SubagentCard(props: { readonly run: SubagentRun; readonly engine: EngineLabel; readonly actions: MarkdownActions }) {
  const { run } = props;
  const status = runStatus(run.status);
  const note = replyNote(run.status);
  const now = Date.now();
  return (
    <li class="subagent-card" data-subagent-id={run.id}>
      <div class="subagent-head">
        <span class="subagent-role">{run.role}</span>
        <span class="subagent-badge">{props.engine(run.binding)}</span>
        <span class="subagent-access">{profileName(run.binding)}</span>
        <span class={`subagent-status tone-${status.tone}`}>
          {status.active && <span class={`pulse ${run.status.kind}`} aria-hidden="true" />}
          {status.text}
        </span>
      </div>
      <div class="exchange-body subagent-body">
        <div class="subagent-label">Prompt</div>
        <Markdown text={run.prompt} actions={props.actions} />
        <div class="subagent-label">Reply</div>
        {note !== null ? <div class="exchange-meta">{note}</div> : run.status.kind === 'finished' && <Markdown text={run.status.reply} actions={props.actions} />}
        <div class="exchange-meta">
          Started {messageTime(run.createdAt, now)}
          {run.status.kind === 'finished' && ` · ended ${messageTime(run.status.finishedAt, now)}`}
        </div>
      </div>
    </li>
  );
}

/** Sub-agents a turn started: one quiet line in the chat, opened in place to show each one's prompt and reply. */
export function SubagentGroup(props: { readonly runs: readonly SubagentRun[]; readonly engine: EngineLabel; readonly actions: MarkdownActions }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const summary = summarizeRuns(props.runs);
  if (summary === null) return null;
  const active = summary.kind === 'single' ? summary.status.active : summary.active;
  return (
    <div class={`exchange subagents${open ? ' open' : ''}`}>
      <button class="exchange-pill" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => { setOpen(!open); }}>
        {active && <span class="pulse" aria-hidden="true" />}
        {summary.kind === 'single' ? (
          <>
            <span class="exchange-verb">Sub-agent</span>
            <span class="subagent-role">{summary.run.role}</span>
            <span class="subagent-badge">{props.engine(summary.run.binding)}</span>
            <span class={`exchange-time tone-${summary.status.tone}`}>{summary.status.text}</span>
          </>
        ) : (
          <>
            <span class="exchange-verb">{String(summary.count)} sub-agents</span>
            <span class="exchange-time">{summary.states}</span>
          </>
        )}
        <span class="exchange-chevron" aria-hidden="true"><Icon name="chevron-down" size={14} /></span>
      </button>
      {open && (
        <ol id={bodyId} class="exchange-cards">
          {props.runs.map((run) => <SubagentCard key={run.id} run={run} engine={props.engine} actions={props.actions} />)}
        </ol>
      )}
    </div>
  );
}
