import type { Routine } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { formatTime } from '../../shared/format.ts';
import { useStore } from '../../shared/use-store.ts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import { IconButton } from '../../shared/ui/Tooltip.tsx';
import { describeSchedule, draftOf, emptyDraft, lastRunLabel } from './routine-copy.ts';
import { RoutineForm, type RoutineFields } from './RoutineForm.tsx';
import type { RoutinesModel } from './routines-model.ts';

type Editing = { readonly kind: 'new' } | { readonly kind: 'edit'; readonly routine: Routine } | null;

const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Only the fields that changed, so an edit never re-sends a one-time schedule whose time has passed. */
function changes(routine: Routine, fields: RoutineFields) {
  return {
    ...(fields.title === routine.title ? {} : { title: fields.title }),
    ...(fields.instruction === routine.instruction ? {} : { instruction: fields.instruction }),
    ...(JSON.stringify(fields.schedule) === JSON.stringify(routine.schedule) ? {} : { schedule: fields.schedule }),
    ...(fields.stayQuietIfNothingNew === routine.stayQuietIfNothingNew ? {} : { stayQuietIfNothingNew: fields.stayQuietIfNothingNew }),
  };
}

function RoutineRow(props: {
  readonly routine: Routine;
  readonly starting: boolean;
  readonly redact: (text: string) => string;
  readonly onActive: (active: boolean) => void;
  readonly onRun: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const { routine } = props;
  const status = lastRunLabel(routine.lastRun, formatTime);
  const running = routine.lastRun?.result.kind === 'running';
  const when = describeSchedule(routine.schedule, formatTime);
  const next = routine.active ? (routine.nextRunAt === null ? null : `Next ${formatTime(routine.nextRunAt)}`) : 'Paused';
  return (
    <div class="routine-row" data-routine={routine.id}>
      <Toggle label={`${routine.title} active`} checked={routine.active} onChange={props.onActive} />
      <div class="setting-text">
        <div class="setting-label">{routine.title}</div>
        <div class="setting-description">{next === null ? when : `${when} · ${next}`}</div>
        <div class={`routine-status ${status.tone}`}>
          <span class={`status-dot ${status.tone}`} />
          <span>{props.redact(status.text)}</span>
        </div>
      </div>
      <div class="setting-control">
        <button type="button" class="btn secondary" disabled={props.starting || running} onClick={props.onRun}>
          {props.starting ? 'Starting…' : 'Run now'}
        </button>
        <IconButton icon="pencil" label={`Edit ${routine.title}`} onClick={props.onEdit} />
        <IconButton icon="trash" label={`Delete ${routine.title}`} onClick={props.onDelete} />
      </div>
    </div>
  );
}

/** Agent Settings › Routines: the agent's scheduled, one-time and by-hand runs, each posting in a chat of its own. */
export function RoutinesSection(props: { readonly model: RoutinesModel; readonly agentId: string; readonly redact: (text: string) => string }) {
  const { model, agentId } = props;
  const state = useStore(model.state);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Routine | null>(null);
  useEffect(() => {
    void model.open(agentId);
  }, [model, agentId]);

  if (editing !== null) {
    const zone = localZone();
    return editing.kind === 'new' ? (
      <RoutineForm
        heading="New routine"
        initial={emptyDraft(zone)}
        saveLabel="Create routine"
        onCancel={() => { setEditing(null); }}
        onSave={async (fields) => {
          const saved = await model.create({ agentId, ...fields });
          if (saved.kind === 'refused') return props.redact(saved.message);
          setEditing(null);
          return null;
        }}
      />
    ) : (
      <RoutineForm
        heading={`Edit ${editing.routine.title}`}
        initial={draftOf(editing.routine, zone)}
        saveLabel="Save"
        onCancel={() => { setEditing(null); }}
        onSave={async (fields) => {
          const changed = changes(editing.routine, fields);
          if (Object.keys(changed).length > 0) {
            const saved = await model.update(editing.routine.id, changed);
            if (saved.kind === 'refused') return props.redact(saved.message);
          }
          setEditing(null);
          return null;
        }}
      />
    );
  }

  const { routines } = state;
  return (
    <div class="settings-section">
      <p class="binding-note">Routines run this agent on a schedule. Each run posts in a chat of its own; runs missed while Ori Bot was off are skipped.</p>
      {state.problem !== null && (
        <p class="note error" role="alert">
          {props.redact(state.problem)}{' '}
          <button type="button" class="btn ghost" onClick={() => { model.dismissProblem(); }}>Dismiss</button>
        </p>
      )}
      {routines.kind === 'loading' && <p class="muted">Loading routines…</p>}
      {routines.kind === 'failed' && <p class="note error" role="alert">{props.redact(routines.message)}</p>}
      {routines.kind === 'loaded' && routines.value.length === 0 && <p class="muted">No routines yet.</p>}
      {routines.kind === 'loaded' && routines.value.length > 0 && (
        <div class="routine-list">
          {routines.value.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              starting={state.starting.has(routine.id)}
              redact={props.redact}
              onActive={(active) => void model.update(routine.id, { active })}
              onRun={() => void model.runNow(routine.id)}
              onEdit={() => { setEditing({ kind: 'edit', routine }); }}
              onDelete={() => { setDeleting(routine); }}
            />
          ))}
        </div>
      )}
      <div class="row">
        <button type="button" class="btn primary" onClick={() => { setEditing({ kind: 'new' }); }}>New routine</button>
      </div>
      {deleting !== null && (
        <ConfirmDialog
          title={`Delete ${deleting.title}?`}
          body={<p>Its schedule and run history are deleted. Chats it already posted stay.</p>}
          confirmLabel="Delete routine"
          tone="danger"
          onCancel={() => { setDeleting(null); }}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void model.remove(id);
          }}
        />
      )}
    </div>
  );
}
