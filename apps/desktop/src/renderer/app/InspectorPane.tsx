import type { Agent } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../bridge.ts';
import type { AgentSection } from '../features/agents/index.ts';
import { accessPill, bindingPill, bindingWarnings } from '../features/binding/index.ts';
import { Inspector, previewOf, type BrainFacts, type InstructionsPreview } from '../features/inspector/index.ts';
import { isRunnable, readinessOf, readyInfo, statusLine, type ProviderChoice } from '../shared/binding-ui/selection.ts';
import { displayPath, redact, type AppInfo } from '../shared/privacy.ts';
import type { Models } from './models.ts';

const NO_INFO: AppInfo = { appVersion: '', homeDir: '', userName: '', dataDir: '' };

/** The Brain card from the agent's binding and its provider's reported info, per §4.6; nothing guessed. */
export function brainFacts(agent: Agent, choice: ProviderChoice | undefined, safe: (text: string) => string): BrainFacts {
  const binding = agent.provider;
  if (binding.kind === 'unbound') return { kind: 'unbound' };
  const runnable = choice !== undefined && isRunnable(choice);
  const warnings = bindingWarnings(choice, binding).map((warning) => (warning.kind === 'profile' ? safe(warning.text) : "Review this provider's status in Settings › Providers."));
  return {
    kind: 'bound',
    provider: choice?.name ?? binding.pluginId,
    status: choice === undefined ? 'Not installed' : statusLine(readinessOf(choice)),
    ready: runnable,
    model: runnable ? bindingPill(choice, binding).label : null,
    access: accessPill(choice, binding).label,
    warnings,
    stateless: readyInfo(choice?.info)?.capabilities.sessions === false,
  };
}

/** The Agent Inspector wired to the app: facts from the models, actions into the app's dialogs. */
export function InspectorPane(props: {
  readonly models: Models;
  readonly bridge: MorrowbotBridge;
  readonly agent: Agent;
  readonly choice: ProviderChoice | undefined;
  readonly info: AppInfo | null;
  readonly onAgentSettings: (section: AgentSection) => void;
  readonly onClose: () => void;
}) {
  const { agent, bridge } = props;
  const info = props.info ?? NO_INFO;
  const safe = (text: string): string => redact(text, info);
  const [instructions, setInstructions] = useState<InstructionsPreview>({ kind: 'loading' });
  useEffect(() => {
    let current = true;
    setInstructions({ kind: 'loading' });
    void props.models.api.instructions(agent.id).then((result) => {
      if (current) setInstructions(result.kind === 'ok' ? previewOf(result.value, safe) : { kind: 'failed' });
    });
    return () => {
      current = false;
    };
  }, [agent.id, props.info]);
  const path = props.info === null ? '…' : displayPath(agent.workspace.dir, info, agent.workspace.dir);
  return (
    <Inspector
      agentName={agent.name}
      facts={{
        description: agent.description,
        workspace: { path, kind: agent.workspace.kind },
        brain: brainFacts(agent, props.choice, safe),
        instructions,
      }}
      actions={{
        onEditAgent: () => { props.onAgentSettings('general'); },
        onCopyPath: () => void bridge.copyText(path),
        onReveal: () => void bridge.revealPath({ kind: 'agent-workspace', agentId: agent.id }),
        onEditBrain: () => { props.onAgentSettings('brain'); },
        onEditInstructions: () => { props.onAgentSettings('instructions'); },
      }}
      onClose={props.onClose}
    />
  );
}
