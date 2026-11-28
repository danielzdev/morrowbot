import { effectiveEmojiReplies, type Agent, type AgentEmojiReplies } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import type { ChatSettingsModel } from '../../shared/chat-settings.ts';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { useStore } from '../../shared/use-store.ts';
import type { AgentsModel } from './agents-model.ts';

const ALLOWED_NOTE = 'It may answer with only an emoji reaction, or stay quiet, when that is the better reply.';
const OFF_NOTE = 'It always answers with a text reply.';

/**
 * Agent Settings › Replies: whether this agent may answer with only an emoji or nothing. It applies at once. While
 * Settings › Chat sets it for every agent, the control shows what applies and is disabled.
 */
export function AgentReplies(props: {
  readonly model: AgentsModel;
  readonly chatSettings: ChatSettingsModel;
  readonly agent: Agent;
  readonly redact: (text: string) => string;
}) {
  const { agent } = props;
  const settings = useStore(props.chatSettings.state);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void props.chatSettings.load();
  }, [props.chatSettings]);
  const global = settings.kind === 'loaded' ? settings.value.emojiReplies : null;
  const fixed = global === 'all' || global === 'off';
  const shown = global === null ? agent.emojiReplies : effectiveEmojiReplies(global, agent.emojiReplies);
  return (
    <div class="settings-section">
      <div class="field">
        <span>Emoji-only / silent replies</span>
        <Segmented<AgentEmojiReplies>
          label="Emoji-only / silent replies"
          value={shown}
          options={[
            { value: 'allowed', label: 'Allowed', disabled: fixed },
            { value: 'off', label: 'Off (always reply with text)', disabled: fixed },
          ]}
          onChange={(emojiReplies) => {
            setProblem(null);
            void props.model.updateAgent(agent.id, { emojiReplies }).then((result) => {
              if (result.kind === 'refused') setProblem(props.redact(result.message));
            });
          }}
        />
      </div>
      <p class="binding-note">{noteFor(global, shown)}</p>
      {settings.kind === 'failed' && <p class="note error" role="alert">{`Couldn't check Settings › Chat: ${props.redact(settings.message)}`}</p>}
      {problem !== null && <p class="note error" role="alert">{problem}</p>}
    </div>
  );
}

function noteFor(global: 'per_agent' | 'all' | 'off' | null, shown: AgentEmojiReplies): string {
  switch (global) {
    case 'all':
      return 'All agents may answer with only an emoji or stay quiet. Change it in Settings › Chat.';
    case 'off':
      return 'Every agent replies with text. Change it in Settings › Chat.';
    case 'per_agent':
    case null:
      return shown === 'allowed' ? ALLOWED_NOTE : OFF_NOTE;
  }
}
