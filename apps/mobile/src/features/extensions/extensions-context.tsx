import { withAgentExtension, type Agent, type PluginList } from '@morrowbot/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExtensionsHost } from './extensions-host.ts';
import type { ExtensionsSegment } from './extensions-model.ts';

export type LoadedPlugins =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'loaded'; readonly list: PluginList };

export type AgentExtensionProblem =
  | { readonly kind: 'conflict'; readonly current: Agent }
  | { readonly kind: 'refused'; readonly message: string };

export const agentRowKey = (pluginId: string, agentId: string): string => `${pluginId}:${agentId}`;

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([each]) => each !== key));
}

function mergeAgents(
  current: readonly Agent[],
  incoming: readonly Agent[],
  known: ReadonlyMap<string, Agent>,
  deleted: ReadonlySet<string>,
): readonly Agent[] {
  const cached = new Map<string, Agent>(known);
  for (const agent of current) {
    const prior = cached.get(agent.id);
    if (prior === undefined || agent.revision >= prior.revision) cached.set(agent.id, agent);
  }
  return incoming
    .filter((agent) => !deleted.has(agent.id))
    .map((agent) => {
      const existing = cached.get(agent.id);
      return existing !== undefined && existing.revision > agent.revision ? existing : agent;
    });
}

export interface ExtensionsState {
  readonly plugins: LoadedPlugins;
  readonly agents: readonly Agent[];
  /** The segment the list shows; kept here so it survives folding and unfolding. */
  readonly segment: ExtensionsSegment;
  readonly setSegment: (segment: ExtensionsSegment) => void;
  /** Plugin ids whose app-wide on/off change is on its way to the host. */
  readonly saving: readonly string[];
  /** Agent ids whose per-agent extension change is on its way to the host. */
  readonly savingAgents: readonly string[];
  /** The last app-wide on/off change the host refused, by plugin id. */
  readonly refused: Readonly<Record<string, string>>;
  /** The last per-agent conflict or refusal, keyed by `agentRowKey(pluginId, agentId)`. */
  readonly agentProblems: Readonly<Record<string, AgentExtensionProblem>>;
  readonly reload: () => void;
  readonly setEnabled: (pluginId: string, enabled: boolean) => void;
  readonly setAgentEnabled: (agent: Agent, pluginId: string, enabled: boolean) => void;
  readonly reloadAgentRow: (pluginId: string, agentId: string) => void;
}

const Context = createContext<ExtensionsState | null>(null);

/** Loads the host's plugins and agents for the Extensions tab and its detail screens, again whenever the link is back `online`. */
export function ExtensionsHostProvider(props: { readonly host: ExtensionsHost; readonly online: boolean; readonly children: ReactNode }) {
  const { host, online } = props;
  const [plugins, setPlugins] = useState<LoadedPlugins>({ kind: 'loading' });
  const [agents, setAgents] = useState<readonly Agent[]>([]);
  const [segment, setSegment] = useState<ExtensionsSegment>('plugins');
  const [saving, setSaving] = useState<readonly string[]>([]);
  const [savingAgents, setSavingAgents] = useState<readonly string[]>([]);
  const [refused, setRefused] = useState<Readonly<Record<string, string>>>({});
  const [agentProblems, setAgentProblems] = useState<Readonly<Record<string, AgentExtensionProblem>>>({});
  const activeHost = useRef(host);
  const pluginsSeq = useRef(0);
  const agentsSeq = useRef(0);
  const knownAgents = useRef(new Map<string, Agent>());
  const deletedAgents = useRef(new Set<string>());

  useEffect(() => {
    activeHost.current = host;
    pluginsSeq.current += 1;
    agentsSeq.current += 1;
    knownAgents.current.clear();
    deletedAgents.current.clear();
    setPlugins({ kind: 'loading' });
    setAgents([]);
    setSaving([]);
    setSavingAgents([]);
    setRefused({});
    setAgentProblems({});
  }, [host]);

  const adoptAgent = useCallback((updated: Agent) => {
    deletedAgents.current.delete(updated.id);
    const prior = knownAgents.current.get(updated.id);
    if (prior === undefined || updated.revision >= prior.revision) knownAgents.current.set(updated.id, updated);
    setAgents((current) => current.map((each) => (each.id === updated.id && updated.revision >= each.revision ? updated : each)));
  }, []);

  const reload = useCallback(() => {
    const minePlugins = ++pluginsSeq.current;
    const mineAgents = ++agentsSeq.current;
    void host.plugins().then((result) => {
      if (activeHost.current !== host || minePlugins !== pluginsSeq.current) return;
      setPlugins(result.kind === 'ok' ? { kind: 'loaded', list: result.value } : { kind: 'failed', message: result.error.message });
    });
    void host.agents().then((result) => {
      if (activeHost.current !== host || mineAgents !== agentsSeq.current) return;
      if (result.kind === 'ok') setAgents((current) => mergeAgents(current, result.value.agents, knownAgents.current, deletedAgents.current));
    });
  }, [host]);

  useEffect(() => {
    if (online) reload();
  }, [reload, online]);

  useEffect(
    () =>
      host.onPluginChanged((entry) => {
        setPlugins((current) =>
          current.kind === 'loaded'
            ? {
                kind: 'loaded',
                list: { ...current.list, plugins: current.list.plugins.map((each) => (each.manifest.id === entry.manifest.id ? entry : each)) },
              }
            : current,
        );
      }),
    [host],
  );

  useEffect(() => host.onAgentChanged(adoptAgent), [host, adoptAgent]);
  useEffect(
    () =>
      host.onAgentDeleted((agentId) => {
        deletedAgents.current.add(agentId);
        knownAgents.current.delete(agentId);
        setAgents((current) => current.filter((each) => each.id !== agentId));
      }),
    [host],
  );

  const setEnabled = useCallback(
    (pluginId: string, enabled: boolean) => {
      setSaving((current) => [...current, pluginId]);
      void host.setPluginEnabled(pluginId, enabled).then((result) => {
        if (activeHost.current !== host) return;
        setSaving((current) => current.filter((id) => id !== pluginId));
        if (result.kind === 'failed') {
          setRefused((current) => ({ ...current, [pluginId]: result.error.message }));
          return;
        }
        setRefused((current) => withoutKey(current, pluginId));
      });
    },
    [host],
  );

  const setAgentEnabled = useCallback(
    (agent: Agent, pluginId: string, enabled: boolean) => {
      const key = agentRowKey(pluginId, agent.id);
      setSavingAgents((current) => [...current, agent.id]);
      setAgentProblems((current) => withoutKey(current, key));
      void host
        .updateAgent(agent.id, {
          disabledExtensions: withAgentExtension(agent.disabledExtensions, pluginId, enabled),
          revision: agent.revision,
        })
        .then((result) => {
          if (activeHost.current !== host) return;
          setSavingAgents((current) => current.filter((id) => id !== agent.id));
          if (result.kind === 'ok') {
            adoptAgent(result.value);
            return;
          }
          setAgentProblems((current) => ({
            ...current,
            [key]:
              result.error.kind === 'agent-conflict'
                ? { kind: 'conflict', current: result.error.current }
                : { kind: 'refused', message: result.error.message },
          }));
        });
    },
    [host, adoptAgent],
  );

  const reloadAgentRow = useCallback(
    (pluginId: string, agentId: string) => {
      const key = agentRowKey(pluginId, agentId);
      const problem = agentProblems[key];
      if (problem?.kind === 'conflict') {
        const adopted = problem.current;
        host.adoptAgent(adopted);
        setAgentProblems((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([eachKey, each]) =>
                eachKey !== key && !(each.kind === 'conflict' && each.current.id === agentId && each.current.revision <= adopted.revision),
            ),
          ),
        );
        return;
      }
      setAgentProblems((current) => withoutKey(current, key));
    },
    [agentProblems, host],
  );

  const value = useMemo(
    () => ({ plugins, agents, segment, setSegment, saving, savingAgents, refused, agentProblems, reload, setEnabled, setAgentEnabled, reloadAgentRow }),
    [plugins, agents, segment, saving, savingAgents, refused, agentProblems, reload, setEnabled, setAgentEnabled, reloadAgentRow],
  );
  return <Context value={value}>{props.children}</Context>;
}

export function useExtensions(): ExtensionsState {
  const state = useContext(Context);
  if (state === null) throw new Error('Extensions screens need an ExtensionsHostProvider above them.');
  return state;
}
