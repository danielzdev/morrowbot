import type { Agent, ScopeMode } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { withAgent, withMode, type ScopeChoice } from './scope-choice.ts';

/** An agent's avatar, which the app draws. */
export type AgentAvatarSlot = (agent: Agent, size: number) => ComponentChildren;

const FILTER_FROM = 6;

const MODES: readonly { readonly value: ScopeMode; readonly label: string }[] = [
  { value: 'all', label: 'All agents' },
  { value: 'selected', label: 'Selected agents' },
];

/** All agents or Selected agents with an avatar checklist (spec IA §5); the parent saves the choice. */
export function ScopePicker(props: {
  readonly choice: ScopeChoice;
  readonly agents: readonly Agent[];
  readonly avatar: AgentAvatarSlot;
  readonly disabled: boolean;
  readonly onChange: (choice: ScopeChoice) => void;
}) {
  const { choice, agents } = props;
  const [filter, setFilter] = useState('');
  const wanted = filter.trim().toLocaleLowerCase();
  const filterable = agents.length >= FILTER_FROM;
  const shown = filterable ? agents.filter(({ name }) => name.toLocaleLowerCase().includes(wanted)) : agents;
  return (
    <div class="scope-picker">
      <Segmented
        label="Available to"
        value={choice.mode}
        options={MODES.map((mode) => ({ ...mode, disabled: props.disabled }))}
        onChange={(mode) => { props.onChange(withMode(choice, mode, agents.map(({ id }) => id))); }}
      />
      <p class="binding-note">{choice.mode === 'all' ? 'Includes agents you create later.' : "New agents don't get this automatically."}</p>
      {choice.mode === 'selected' && (
        <>
          {filterable && (
            <input type="text" class="scope-filter" aria-label="Filter agents" placeholder="Filter agents…" spellcheck={false} value={filter} onInput={(event) => { setFilter(event.currentTarget.value); }} />
          )}
          <ul class="scope-agents" aria-label="Agents">
            {shown.map((agent) => (
              <li key={agent.id}>
                <label class="scope-agent">
                  <input
                    type="checkbox"
                    disabled={props.disabled}
                    checked={choice.agentIds.includes(agent.id)}
                    onChange={(event) => { props.onChange(withAgent(choice, agent.id, event.currentTarget.checked)); }}
                  />
                  {props.avatar(agent, 20)}
                  <span>{agent.name}</span>
                </label>
              </li>
            ))}
          </ul>
          {agents.length === 0 && <p class="muted">You have no agents yet.</p>}
          {agents.length > 0 && shown.length === 0 && <p class="muted">No matches.</p>}
        </>
      )}
    </div>
  );
}

/** A saved scope that can't be edited here: who it names, read-only. */
export function SavedScope(props: { readonly choice: ScopeChoice; readonly agents: readonly Agent[]; readonly avatar: AgentAvatarSlot }) {
  if (props.choice.mode === 'all') return <p class="muted">Saved: All agents.</p>;
  const named = props.agents.filter(({ id }) => props.choice.agentIds.includes(id));
  if (named.length === 0) return <p class="muted">Saved: Selected agents, with none ticked.</p>;
  return (
    <ul class="scope-agents saved" aria-label="Saved agents">
      {named.map((agent) => (
        <li key={agent.id} class="scope-agent">
          {props.avatar(agent, 20)}
          <span>{agent.name}</span>
        </li>
      ))}
    </ul>
  );
}
