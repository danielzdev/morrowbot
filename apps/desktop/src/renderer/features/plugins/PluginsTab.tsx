import type { PluginEntry, PluginList, PluginOrigin, PluginProblem } from '@morrowbot/contracts';
import { ItemMark } from '../../shared/ui/ItemMark.tsx';
import { ListDetail, ListRow, Pill } from '../../shared/ui/ListDetail.tsx';
import type { AgentExtensionsPort } from './agent-extensions.ts';
import { PluginDetail, ProblemDetail, sourceLabel, type PluginActions } from './PluginDetail.tsx';
import { healthOf, isListedPlugin, problemHealth } from './plugin-health.ts';
import type { PluginActivity } from './plugins-model.ts';

/** One selectable row of the Plugins tab: a plugin, or a folder that could not be loaded. */
export type PluginItem = { readonly kind: 'plugin'; readonly key: string; readonly entry: PluginEntry } | { readonly kind: 'problem'; readonly key: string; readonly problem: PluginProblem };

const matches = (text: string, query: string): boolean => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

/** The Plugins tab's rows in list order, filtered by the search. Built-in providers live in Settings › Providers. */
export function pluginItems(list: PluginList, query: string): readonly PluginItem[] {
  const plugins: PluginItem[] = list.plugins
    .filter((entry) => isListedPlugin(entry) && (matches(entry.manifest.name, query) || matches(entry.manifest.id, query)))
    .map((entry) => ({ kind: 'plugin', key: `plugin:${entry.manifest.id}`, entry }));
  const problems: PluginItem[] = list.problems
    .map((problem, index): PluginItem => ({ kind: 'problem', key: `problem:${String(index)}`, problem }))
    .filter((item) => item.kind === 'problem' && matches(problemHealth(item.problem).title, query));
  return [...plugins, ...problems];
}

const originOf = (item: PluginItem): PluginOrigin => (item.kind === 'plugin' ? item.entry.source : item.problem.source);

function ItemRow(props: { readonly item: PluginItem; readonly selected: boolean; readonly tabStop: boolean; readonly redact: (text: string) => string; readonly onSelect: () => void }) {
  const { item } = props;
  const title = item.kind === 'plugin' ? item.entry.manifest.name : props.redact(problemHealth(item.problem).title);
  const health = item.kind === 'plugin' ? healthOf(item.entry.status) : problemHealth(item.problem);
  return (
    <ListRow label={title} selected={props.selected} tabStop={props.tabStop} onSelect={props.onSelect}>
      <ItemMark name={title} />
      <span class="item-text">
        <span class="item-name">
          {title}
          {item.kind === 'plugin' && <span class="tag">{sourceLabel(item.entry)}</span>}
          {item.kind === 'plugin' && <span class="mono item-version">v{item.entry.manifest.version}</span>}
        </span>
        <Pill tone={health.tone}>{health.label}</Pill>
      </span>
    </ListRow>
  );
}

export interface PluginsTabProps {
  readonly list: PluginList;
  readonly items: readonly PluginItem[];
  readonly activity: PluginActivity;
  readonly selected: PluginItem | undefined;
  readonly searching: boolean;
  readonly pluginsDir: string;
  readonly agentExtensions?: AgentExtensionsPort;
  readonly redact: (text: string) => string;
  readonly onSelect: (key: string) => void;
  readonly onRescan: () => void;
  readonly onOpenFolder: () => void;
  readonly onBrowse: () => void;
  readonly actionsFor: (entry: PluginEntry) => PluginActions;
}

/** Extensions › Plugins (spec §6.3, IA §3): Built-in and Yours, health pills, discovery problems, and the detail. */
export function PluginsTab(props: PluginsTabProps) {
  const { items, selected, redact } = props;
  const group = (origin: PluginOrigin) => items.filter((item) => originOf(item) === origin);
  const row = (item: PluginItem) => (
    <ItemRow key={item.key} item={item} selected={item === selected} tabStop={item === selected || (selected === undefined && item === items[0])} redact={redact} onSelect={() => { props.onSelect(item.key); }} />
  );
  const builtIn = group('built-in');
  const yours = group('user');
  return (
    <ListDetail
      label="Plugins"
      list={
        <>
          <div class="kicker list-group">Built-in</div>
          {builtIn.map(row)}
          {builtIn.length === 0 && <p class="list-empty muted">{props.searching ? 'No matches.' : 'No built-in plugins in this version.'}</p>}
          <div class="kicker list-group">Yours</div>
          {yours.map(row)}
          {yours.length === 0 && !props.searching && (
            <div class="list-empty empty-card">
              <p>Add plugins by putting them in this folder.</p>
              <p class="mono">{props.pluginsDir}</p>
              <div class="row">
                <button type="button" class="btn secondary" onClick={props.onOpenFolder}>
                  Open plugins folder
                </button>
                <button type="button" class="btn ghost" onClick={props.onBrowse}>
                  Browse plugins
                </button>
              </div>
            </div>
          )}
          {yours.length === 0 && props.searching && <p class="list-empty muted">No matches.</p>}
        </>
      }
      detail={
        selected === undefined ? (
          <p class="muted detail-empty">{items.length === 0 ? 'Nothing to show yet.' : 'Choose a plugin to see its details.'}</p>
        ) : selected.kind === 'plugin' ? (
          <PluginDetail
            key={selected.key}
            entry={selected.entry}
            safeMode={props.list.safeMode}
            work={props.activity.busy[selected.entry.manifest.id]}
            problem={props.activity.problems[selected.entry.manifest.id]}
            {...(props.agentExtensions === undefined ? {} : { agentExtensions: props.agentExtensions })}
            redact={redact}
            actions={props.actionsFor(selected.entry)}
          />
        ) : (
          <ProblemDetail key={selected.key} problem={selected.problem} redact={redact} rescanning={props.activity.rescan.kind === 'running'} onRescan={props.onRescan} onOpenFolder={props.onOpenFolder} />
        )
      }
    />
  );
}
