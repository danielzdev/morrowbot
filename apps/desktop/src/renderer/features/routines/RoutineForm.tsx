import { QUIET_MARKER, type RoutineSchedule } from '@morrowbot/contracts';
import { useState } from 'preact/hooks';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { scheduleOf, type RoutineDraft } from './routine-copy.ts';

export interface RoutineFields {
  readonly title: string;
  readonly instruction: string;
  readonly schedule: RoutineSchedule;
  readonly stayQuietIfNothingNew: boolean;
}

const WHEN: readonly { readonly value: RoutineSchedule['kind']; readonly label: string }[] = [
  { value: 'cron', label: 'Repeat' },
  { value: 'once', label: 'Once' },
  { value: 'manual', label: 'By hand' },
];

/** New or Edit routine, in place of the list. Save stays off until the draft can be saved. */
export function RoutineForm(props: {
  readonly heading: string;
  readonly initial: RoutineDraft;
  readonly saveLabel: string;
  readonly onSave: (fields: RoutineFields) => Promise<string | null>;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const edit = (change: Partial<RoutineDraft>): void => {
    setDraft((current) => ({ ...current, ...change }));
  };
  const schedule = scheduleOf(draft);
  const ready = draft.title.trim() !== '' && draft.instruction.trim() !== '' && schedule.kind === 'ok';
  return (
    <form
      class="settings-section routine-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || saving) return;
        setSaving(true);
        void props
          .onSave({ title: draft.title.trim(), instruction: draft.instruction.trim(), schedule: schedule.schedule, stayQuietIfNothingNew: draft.stayQuiet })
          .then((refused) => {
            setSaving(false);
            setProblem(refused);
          });
      }}
    >
      <h3 class="section-title">{props.heading}</h3>
      <label class="field">
        <span>Title</span>
        <input required maxLength={200} value={draft.title} placeholder="Morning check-in" onInput={(event) => { edit({ title: event.currentTarget.value }); }} />
      </label>
      <label class="field">
        <span>Instruction</span>
        <textarea rows={4} value={draft.instruction} placeholder="What should the agent do each run?" onInput={(event) => { edit({ instruction: event.currentTarget.value }); }} />
      </label>
      <div class="field">
        <span>When</span>
        <Segmented label="When it runs" value={draft.kind} options={WHEN} onChange={(kind) => { edit({ kind }); }} />
      </div>
      {draft.kind === 'cron' && (
        <div class="routine-cron">
          <label class="field">
            <span>Cron pattern</span>
            <input class="mono" value={draft.expr} spellcheck={false} onInput={(event) => { edit({ expr: event.currentTarget.value }); }} />
          </label>
          <label class="field">
            <span>Time zone</span>
            <input value={draft.timezone} spellcheck={false} onInput={(event) => { edit({ timezone: event.currentTarget.value }); }} />
          </label>
          <p class="binding-note">Minute, hour, day, month, weekday. For example, 0 9 * * 1-5 runs at 09:00 on weekdays.</p>
        </div>
      )}
      {draft.kind === 'once' && (
        <label class="field">
          <span>Date and time</span>
          <input type="datetime-local" value={draft.runAt} onInput={(event) => { edit({ runAt: event.currentTarget.value }); }} />
        </label>
      )}
      {draft.kind === 'manual' && <p class="binding-note">Runs only from Run now, or when a local script wakes it.</p>}
      <label class="choice">
        <input type="checkbox" checked={draft.stayQuiet} onChange={(event) => { edit({ stayQuiet: event.currentTarget.checked }); }} />
        <span>
          Stay quiet if nothing is new
          <small>The agent answers {QUIET_MARKER} and the run leaves no chat behind.</small>
        </span>
      </label>
      <div class="section-actions">
        {schedule.kind === 'invalid' && draft.kind !== 'once' && <p class="note warn">{schedule.reason}</p>}
        {problem !== null && <p class="note error" role="alert">{problem}</p>}
        <div class="row">
          <button type="button" class="btn secondary" disabled={saving} onClick={props.onCancel}>Cancel</button>
          <button type="submit" class="btn primary" disabled={!ready || saving}>{saving ? 'Saving…' : props.saveLabel}</button>
        </div>
      </div>
    </form>
  );
}
