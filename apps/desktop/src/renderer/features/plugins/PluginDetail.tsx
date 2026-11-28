import type { PluginConfig, PluginEntry, PluginPermission, PluginProblem } from '@morrowbot/contracts';
import { ItemMark } from '../../shared/ui/ItemMark.tsx';
import { DetailSection, Pill } from '../../shared/ui/ListDetail.tsx';
import { SettingsForm } from '../../shared/ui/SettingsForm.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import { healthOf, problemHealth } from './plugin-health.ts';
import type { PluginWork } from './plugins-model.ts';

const PERMISSIONS: Readonly<Record<PluginPermission, string>> = {
  network: 'Use the internet',
  filesystem: 'Read and change files',
  shell: 'Run commands on this computer',
  secrets: 'Use saved passwords and keys',
  accessibility: 'See and control apps on this Mac (Accessibility)',
  'screen-recording': 'Take pictures of the screen (Screen Recording)',
};

export const sourceLabel = (entry: PluginEntry): string => (entry.source === 'built-in' ? 'Built-in' : 'Yours');

export interface PluginActions {
  readonly onEnabled: (enabled: boolean) => void;
  readonly onRestart: () => void;
  readonly onSaveConfig: (config: PluginConfig) => void;
  readonly onOpenFolder: () => void;
  readonly onOpenProvider: () => void;
  readonly onDirty: (dirty: boolean) => void;
}

/** The one place a plugin is managed (spec IA §4): header, health, permissions, settings and Restart. */
export function PluginDetail(props: {
  readonly entry: PluginEntry;
  readonly safeMode: boolean;
  readonly work: PluginWork | undefined;
  readonly problem: string | undefined;
  readonly redact: (text: string) => string;
  readonly actions: PluginActions;
}) {
  const { entry, actions, redact } = props;
  const { manifest } = entry;
  const health = healthOf(entry.status);
  const canRestart = !props.safeMode && entry.enabled && entry.status.kind !== 'quarantined';
  return (
    <article class="detail" aria-label={manifest.name}>
      <header class="detail-header">
        <ItemMark name={manifest.name} />
        <div class="detail-title">
          <h2>{manifest.name}</h2>
          <div class="muted">
            {sourceLabel(entry)} · {manifest.kind === 'provider' ? 'Provider' : 'Tool'} · <span class="mono">v{manifest.version}</span>
          </div>
        </div>
        <Pill tone={health.tone}>{health.label}</Pill>
        <Toggle label={`${manifest.name} on`} checked={entry.enabled} disabled={props.work !== undefined} onChange={actions.onEnabled} />
      </header>

      {(health.detail !== null || props.problem !== undefined) && (
        <section class="status-card" aria-label="Details">
          {health.detail !== null && <p class="status-detail">{redact(health.detail)}</p>}
          {props.problem !== undefined && (
            <p class="status-problem" role="alert">
              {redact(props.problem)}
            </p>
          )}
        </section>
      )}

      <div class="detail-actions">
        {manifest.kind === 'provider' && (
          <button type="button" class="btn secondary" onClick={actions.onOpenProvider}>
            Configure in Providers →
          </button>
        )}
        <button type="button" class="btn secondary" disabled={!canRestart || props.work !== undefined} onClick={actions.onRestart}>
          {props.work === 'restarting' ? 'Restarting…' : 'Restart'}
        </button>
        {entry.source === 'user' && (
          <button type="button" class="btn ghost" onClick={actions.onOpenFolder}>
            Open plugins folder
          </button>
        )}
      </div>

      <DetailSection title="Permissions">
        {manifest.permissions.length === 0 ? (
          <p class="muted">Needs no special access.</p>
        ) : (
          <ul class="fact-list">
            {manifest.permissions.map((permission) => (
              <li key={permission}>{PERMISSIONS[permission]}</li>
            ))}
          </ul>
        )}
        <p class="muted">Plugins are trusted code: Ori Kami runs each in its own process, but does not sandbox it.</p>
      </DetailSection>

      {Object.keys(manifest.settingsSchema).length > 0 && (
        <DetailSection title="Settings">
          <SettingsForm
            key={JSON.stringify(entry.config)}
            idPrefix={`plugin-${manifest.id}`}
            schema={manifest.settingsSchema}
            saved={entry.config}
            busy={props.work === 'saving'}
            onSave={actions.onSaveConfig}
            onDirty={actions.onDirty}
          />
        </DetailSection>
      )}
      {entry.source === 'built-in' && <p class="muted">Built-in plugins ship with Ori Kami and can't be removed. Turn one off to stop it.</p>}
    </article>
  );
}

/** A folder discovery could not load: what went wrong, and how to fix it. */
export function ProblemDetail(props: { readonly problem: PluginProblem; readonly redact: (text: string) => string; readonly rescanning: boolean; readonly onRescan: () => void; readonly onOpenFolder: () => void }) {
  const health = problemHealth(props.problem);
  return (
    <article class="detail" aria-label={health.title}>
      <header class="detail-header">
        <ItemMark name={health.title} />
        <div class="detail-title">
          <h2>{props.redact(health.title)}</h2>
          <div class="muted">{props.problem.source === 'built-in' ? 'Built-in plugins folder' : 'Your plugins folder'}</div>
        </div>
        <Pill tone={health.tone}>{health.label}</Pill>
      </header>
      <section class="status-card" aria-label="Details">
        {health.detail !== null && <p class="status-detail">{props.redact(health.detail)}</p>}
        <p class="muted">Fix the folder, then choose Rescan. Other plugins and chat keep working meanwhile.</p>
      </section>
      <div class="detail-actions">
        <button type="button" class="btn secondary" disabled={props.rescanning} onClick={props.onRescan}>
          {props.rescanning ? 'Rescanning…' : 'Rescan'}
        </button>
        {props.problem.source === 'user' && (
          <button type="button" class="btn ghost" onClick={props.onOpenFolder}>
            Open plugins folder
          </button>
        )}
      </div>
    </article>
  );
}
