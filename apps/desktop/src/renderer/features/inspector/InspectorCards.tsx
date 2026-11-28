import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from '../../shared/ui/Icon.tsx';
import type { BrainFacts, InspectorFacts, InstructionsPreview } from './inspector-facts.ts';

export const NOT_REPORTED = 'Not reported';

export interface InspectorActions {
  readonly onEditAgent: () => void;
  readonly onCopyPath: () => void;
  readonly onReveal: () => void;
  readonly onEditBrain: () => void;
  readonly onEditInstructions: () => void;
}

function Card(props: { readonly id: string; readonly title: string; readonly children: ComponentChildren; readonly actions: ComponentChildren }) {
  return (
    <section class="inspector-card" aria-labelledby={`inspector-${props.id}`}>
      <h3 id={`inspector-${props.id}`} class="kicker">
        {props.title}
      </h3>
      {props.children}
      {props.actions !== null && <div class="inspector-actions">{props.actions}</div>}
    </section>
  );
}

/** One fact: its value, or "Not reported" when the renderer receives no such field. */
function Fact(props: { readonly label: string; readonly value: string | null }) {
  return (
    <div class="inspector-fact">
      <dt>{props.label}</dt>
      <dd class={props.value === null ? 'not-reported' : undefined}>{props.value ?? NOT_REPORTED}</dd>
    </div>
  );
}

const action = (label: string, run: () => void) => (
  <button type="button" class="btn secondary" onClick={run}>
    {label}
  </button>
);

function CopyPath(props: { readonly onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      class="btn secondary"
      onClick={() => {
        props.onCopy();
        setCopied(true);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} />
      {copied ? 'Copied' : 'Copy path'}
    </button>
  );
}

function BrainCard(props: { readonly brain: BrainFacts; readonly onEdit: () => void }) {
  const { brain } = props;
  if (brain.kind === 'unbound') {
    return (
      <Card id="brain" title="Brain" actions={action('Choose a provider', props.onEdit)}>
        <p class="inspector-text">This agent has no provider yet, so it can't reply.</p>
      </Card>
    );
  }
  return (
    <Card id="brain" title="Brain" actions={action('Edit brain', props.onEdit)}>
      <dl class="inspector-facts">
        <Fact label="Provider" value={brain.provider} />
        <Fact label="Status" value={brain.status} />
        <Fact label="Model" value={brain.model} />
        <Fact label="Access" value={brain.access} />
      </dl>
      {brain.warnings.length > 0 && (
        <ul class="inspector-warnings">
          {brain.warnings.map((warning) => (
            <li key={warning}>
              <Icon name="warning" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function instructionsBody(preview: InstructionsPreview): ComponentChildren {
  switch (preview.kind) {
    case 'loading':
      return <p class="inspector-text muted">Loading…</p>;
    case 'missing':
      return <p class="inspector-text muted">No AGENTS.md yet.</p>;
    case 'empty':
      return <p class="inspector-text muted">AGENTS.md is empty.</p>;
    case 'unreadable':
      return <p class="inspector-text muted">AGENTS.md could not be read.</p>;
    case 'failed':
      return <p class="inspector-text not-reported">{NOT_REPORTED}</p>;
    case 'text':
      return (
        <pre class="inspector-instructions mono">
          {preview.lines.join('\n')}
          {preview.more ? '\n…' : ''}
        </pre>
      );
  }
}

/** The Inspector's cards, in the spec §3.4 order. Every value comes from a field the renderer receives. */
export function InspectorCards(props: { readonly facts: InspectorFacts; readonly actions: InspectorActions }) {
  const { facts, actions } = props;
  const { brain } = facts;
  return (
    <>
      <Card id="agent" title="Agent" actions={action('Edit agent', actions.onEditAgent)}>
        <p class={facts.description === '' ? 'inspector-text muted' : 'inspector-text'}>{facts.description === '' ? 'No description.' : facts.description}</p>
      </Card>
      <Card
        id="workspace"
        title="Workspace"
        actions={
          <>
            <CopyPath onCopy={actions.onCopyPath} />
            {action('Reveal in Finder', actions.onReveal)}
          </>
        }
      >
        <p class="inspector-path mono">{facts.workspace.path}</p>
        <p class="inspector-text muted">{facts.workspace.kind === 'dedicated' ? 'Dedicated: only this agent uses it.' : 'Shared: other agents may use it too.'}</p>
      </Card>
      <BrainCard brain={brain} onEdit={actions.onEditBrain} />
      {brain.kind === 'bound' && brain.stateless && (
        <Card id="session" title="Session" actions={null}>
          <p class="inspector-text">This provider gets recent chat history each turn, within its limits.</p>
        </Card>
      )}
      <Card id="instructions" title="Instructions" actions={action('Edit instructions', actions.onEditInstructions)}>
        {instructionsBody(facts.instructions)}
      </Card>
      <Card id="chat" title="This chat" actions={null}>
        <dl class="inspector-facts">
          <Fact label="Last turn tokens" value={null} />
          <Fact label="Model that replied" value={null} />
        </dl>
      </Card>
    </>
  );
}
