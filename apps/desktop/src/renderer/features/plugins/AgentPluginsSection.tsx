import type { Agent, PluginEntry } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import { ItemMark } from '../../shared/ui/ItemMark.tsx';
import { Pill } from '../../shared/ui/ListDetail.tsx';
import { Toggle } from '../../shared/ui/Toggle.tsx';
import { useStore } from '../../shared/use-store.ts';
import {
  CONFLICT_LINE,
  isPluginEnabledForAgent,
  nextDisabledForAgent,
  withoutKey,
  type AgentExtensionOutcome,
  type ExtensionRowProblem,
} from './agent-extensions.ts';
import { healthOf } from './plugin-health.ts';
import { sourceLabel } from './PluginDetail.tsx';
import type { PluginsModel } from './plugins-model.ts';

function PluginRow(props: {
  readonly entry: PluginEntry;
  readonly agent: Agent;
  readonly agentBusy: boolean;
  readonly pluginBusy: boolean;
  readonly pluginProblem: string | undefined;
  readonly problem: ExtensionRowProblem | undefined;
  readonly redact: (text: string) => string;
  readonly onToggleAgent: (enabled: boolean) => void;
  readonly onToggleAll: (enabled: boolean) => void;
  readonly onReload: () => void;
}) {
  const { entry, agent, problem } = props;
  const { manifest } = entry;
  const health = healthOf(entry.status);
  const conflicted = problem?.kind === 'conflict';
  const enabledForAgent = entry.enabled && isPluginEnabledForAgent(agent, manifest.id);
  return (
    <li class={`agent-plugin-row${entry.enabled ? '' : ' dimmed'}`}>
      <div class="agent-plugin-line">
        <div class="agent-plugin-info">
          <ItemMark name={manifest.name} />
          <span class="agent-plugin-name">{manifest.name}</span>
          <span class="tag">{sourceLabel(entry)}</span>
          {entry.status.kind !== 'running' && <Pill tone={health.tone}>{health.label}</Pill>}
        </div>
        <div class="agent-plugin-toggles">
          <label class="toggle-pair">
            <span class="toggle-pair-label">This agent</span>
            <Toggle
              label={`${manifest.name} for ${agent.name}`}
              checked={enabledForAgent}
              disabled={!entry.enabled || props.agentBusy || conflicted}
              onChange={props.onToggleAgent}
            />
          </label>
          <label class="toggle-pair">
            <span class="toggle-pair-label">All agents</span>
            <Toggle
              label={`${manifest.name} for all agents`}
              checked={entry.enabled}
              disabled={props.pluginBusy}
              onChange={props.onToggleAll}
            />
          </label>
        </div>
      </div>
      {!entry.enabled && <p class="binding-note">Off for all agents</p>}
      {problem?.kind === 'conflict' && (
        <div class="row" role="alert">
          <span class="note warn">{CONFLICT_LINE}</span>
          <button type="button" class="btn secondary" onClick={props.onReload}>Reload row</button>
        </div>
      )}
      {problem?.kind === 'refused' && <p class="note error" role="alert">{props.redact(problem.message)}</p>}
      {props.pluginProblem !== undefined && <p class="note error" role="alert">{props.redact(props.pluginProblem)}</p>}
    </li>
  );
}

/** Tool plugins section inside Agent Settings › Extensions: per-agent switch beside the app-wide switch. */
export function AgentPluginsSection(props: {
  readonly model: PluginsModel;
  readonly agent: Agent;
  readonly savingAgent: boolean;
  readonly setDisabled: (agentId: string, disabledExtensions: readonly string[], revision: number) => Promise<AgentExtensionOutcome>;
  readonly adopt: (agent: Agent) => void;
  readonly redact: (text: string) => string;
}) {
  const { model, agent } = props;
  const loaded = useStore(model.list);
  const activity = useStore(model.activity);
  const [problems, setProblems] = useState<Readonly<Record<string, ExtensionRowProblem>>>({});

  useEffect(() => {
    void model.load();
  }, [model]);

  useEffect(() => {
    setProblems({});
  }, [agent.id]);

  const tools = loaded.kind === 'loaded' ? loaded.value.plugins.filter(({ manifest }) => manifest.kind === 'tool') : [];
  if (loaded.kind === 'loaded' && tools.length === 0) return null;

  const toggleAgent = async (pluginId: string, enabled: boolean): Promise<void> => {
    setProblems((now) => withoutKey(now, pluginId));
    const outcome = await props.setDisabled(agent.id, nextDisabledForAgent(agent, pluginId, enabled), agent.revision);
    switch (outcome.kind) {
      case 'saved':
        return;
      case 'conflict':
        setProblems((now) => ({ ...now, [pluginId]: { kind: 'conflict', current: outcome.current } }));
        return;
      case 'refused':
        setProblems((now) => ({ ...now, [pluginId]: { kind: 'refused', message: outcome.message } }));
        return;
    }
  };

  const reloadRow = (pluginId: string): void => {
    const problem = problems[pluginId];
    if (problem?.kind === 'conflict') {
      const adopted = problem.current;
      props.adopt(adopted);
      setProblems((now) =>
        Object.fromEntries(
          Object.entries(now).filter(([key, each]) => key !== pluginId && !(each.kind === 'conflict' && each.current.revision <= adopted.revision)),
        ),
      );
      return;
    }
    setProblems((now) => withoutKey(now, pluginId));
  };

  return (
    <div class="settings-section">
      <div class="kicker">Plugins</div>
      <p class="binding-note">Toggle a plugin for {agent.name} only, or turn it off for all agents.</p>
      {loaded.kind === 'loading' && <p class="muted">Loading plugins…</p>}
      {loaded.kind === 'failed' && (
        <div class="row" role="alert">
          <span class="note error">{props.redact(loaded.message)}</span>
          <button type="button" class="btn secondary" onClick={() => void model.load()}>Try again</button>
        </div>
      )}
      {tools.length > 0 && (
        <ul class="agent-plugins" aria-label="Plugins">
          {tools.map((entry) => {
            const id = entry.manifest.id;
            return (
              <PluginRow
                key={id}
                entry={entry}
                agent={agent}
                agentBusy={props.savingAgent}
                pluginBusy={activity.busy[id] !== undefined}
                pluginProblem={activity.problems[id]}
                problem={problems[id]}
                redact={props.redact}
                onToggleAgent={(enabled) => void toggleAgent(id, enabled)}
                onToggleAll={(enabled) => void model.setEnabled(id, enabled)}
                onReload={() => { reloadRow(id); }}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
