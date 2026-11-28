import type { Agent } from '@morrowbot/contracts';
import type { MorrowbotBridge } from '../bridge.ts';
import { NewAgentForm, type AvatarEditor, type NewAgentLayout } from '../features/agents/index.ts';
import { AvatarPicker, freshAvatar } from '../features/avatar/index.ts';
import { displayPath, redact, type AppInfo } from '../shared/privacy.ts';
import { useStore } from '../shared/use-store.ts';
import { providerChoicesOf } from './derive.ts';
import type { Models } from './models.ts';

const NO_INFO: AppInfo = { appVersion: '', homeDir: '', userName: '', dataDir: '' };

/** New Agent wired to the app's models: the ⇧⌘N dialog and first-run setup's last step. */
export function NewAgent(props: {
  readonly layout: NewAgentLayout;
  readonly models: Models;
  readonly bridge: MorrowbotBridge;
  readonly info: AppInfo | null;
  readonly reducedMotion: boolean;
  /** True only for the server's owner, who may grant full access (shell commands). */
  readonly allowFull: boolean;
  readonly onOpenProviders: () => void;
  readonly onCreated: (agent: Agent) => void;
}) {
  const { models } = props;
  const cards = useStore(models.providers.cards);
  const info = props.info ?? NO_INFO;
  const avatarEditor: AvatarEditor = (value, onChange, previewSize) => (
    <AvatarPicker value={value} onChange={onChange} previewSize={previewSize} reducedMotion={props.reducedMotion} />
  );
  return (
    <NewAgentForm
      layout={props.layout}
      model={models.agents}
      bridge={props.bridge}
      choices={providerChoicesOf(cards)}
      allowFull={props.allowFull}
      avatarEditor={avatarEditor}
      newAvatar={freshAvatar}
      pathLabel={(path) => displayPath(path, info)}
      redact={(text) => redact(text, info)}
      onOpenProviders={props.onOpenProviders}
      onCreated={props.onCreated}
    />
  );
}
