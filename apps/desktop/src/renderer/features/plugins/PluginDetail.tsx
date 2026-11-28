import type { PluginConfig, PluginEntry, PluginPermission, PluginProblem } from '@morrowbot/contracts';
import { useState } from 'preact/hooks';
import { ItemMark } from '../../shared/ui/ItemMark.tsx';
import { DetailSection, Pill } from '../../shared/ui/ListDetail.tsx';
import { SettingsForm } from '../../shared/ui/SettingsForm.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import {
  CONFLICT_LINE,
  isPluginEnabledForAgent,
  nextDisabledForAgent,
  withoutKey,
  type AgentExtensionsPort,
  type ExtensionRowProblem,
} from './agent-extensions.ts';
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

/** Per-agent toggle list inside a tool plugin's detail pane, right below the app-wide switch. */
function PluginAgentsSection(props: {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly enabledAppWide: boolean;
  readonly agentExtensions: AgentExtensionsPort;
  readonly redact: (text: string) => string;
}) {
  const { pluginId, pluginName, enabledAppWide, agentExtensions } = props;
  const [problems, setProblems] = useState<Readonly<Record<string, ExtensionRowProblem>>>({});

  const toggle = async (agentId: string, enabled: boolean): Promise<void> => {
    const agent = agentExtensions.agents.find(({ id }) => id === agentId);
    if (agent === undefined) return;
    setProblems((now) => withoutKey(now, agentId));
    const outcome = await agentExtensions.setDisabled(agent.id, nextDisabledForAgent(agent, pluginId, enabled), agent.revision);
    switch (outcome.kind) {
      case 'saved':
        return;
      case 'conflict':
        setProblems((now) => ({ ...now, [agentId]: { kind: 'conflict', current: outcome.current } }));
        return;
      case 'refused':
        setProblems((now) => ({ ...now, [agentId]: { kind: 'refused', message: outcome.message } }));
        return;
    }
  };

  const reloadRow = (agentId: string): void => {
    const problem = problems[agentId];
    if (problem?.kind === 'conflict') agentExtensions.adopt(problem.current);
    setProblems((now) => withoutKey(now, agentId));
  };

  return (
    <DetailSection title="Agents">
      {!enabledAppWide && <p class="muted">Turned off for all agents above.</p>}
      {agentExtensions.agents.length === 0 ? (
        <p class="muted">No agents yet.</p>
      ) : (
        <ul class="plugin-agents" aria-label={`Agents using ${pluginName}`}>
          {agentExtensions.agents.map((agent) => {
            const problem = problems[agent.id];
            const conflicted = problem?.kind === 'conflict';
            const checked = enabledAppWide && isPluginEnabledForAgent(agent, pluginId);
            return (
              <li key={agent.id} class={`plugin-agent-row${enabledAppWide ? '' : ' dimmed'}`}>
                <div class="plugin-agent-line">
                  <span class="plugin-agent-name">{agent.name}</span>
                  <Toggle
                    label={`${pluginName} for ${agent.name}`}
                    checked={checked}
                    disabled={!enabledAppWide || agentExtensions.savingAgents.includes(agent.id) || conflicted}
                    onChange={(next) => void toggle(agent.id, next)}
                  />
                </div>
                {problem?.kind === 'conflict' && (
                  <div class="row" role="alert">
                    <span class="note warn">{CONFLICT_LINE}</span>
                    <button type="button" class="btn secondary" onClick={() => { reloadRow(agent.id); }}>Reload row</button>
                  </div>
                )}
                {problem?.kind === 'refused' && <p class="note error" role="alert">{props.redact(problem.message)}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </DetailSection>
  );
}

/** The one place a plugin is managed (spec IA §4): header, health, per-agent toggles, permissions, settings and Restart. */
export function PluginDetail(props: {
  readonly entry: PluginEntry;
  readonly safeMode: boolean;
  readonly work: PluginWork | undefined;
  readonly problem: string | undefined;
  readonly agentExtensions?: AgentExtensionsPort;
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
        <label class="toggle-pair">
          {manifest.kind === 'tool' && <span class="toggle-pair-label">All agents</span>}
          <Toggle label={`${manifest.name} on`} checked={entry.enabled} disabled={props.work !== undefined} onChange={actions.onEnabled} />
        </label>
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

      {manifest.kind === 'tool' && props.agentExtensions !== undefined && (
        <PluginAgentsSection
          pluginId={manifest.id}
          pluginName={manifest.name}
          enabledAppWide={entry.enabled}
          agentExtensions={props.agentExtensions}
          redact={redact}
        />
      )}

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
        <p class="muted">Plugins are trusted code: MorrowBot runs each in its own process, but does not sandbox it.</p>
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
      {entry.source === 'built-in' && <p class="muted">Built-in plugins ship with MorrowBot and can't be removed. Turn one off to stop it.</p>}
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
