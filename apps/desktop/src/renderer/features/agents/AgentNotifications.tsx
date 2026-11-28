import { Segmented } from '../../shared/ui/Segmented.tsx';
import { useStore } from '../../shared/use-store.ts';
import { AgentNotify, NOTIFY_COPY, notifyOf, type AgentNotifyModel } from './agent-notify.ts';

/** Agent Settings › Notifications: All, Quiet or Muted, applied at once. */
export function AgentNotifications(props: { readonly notify: AgentNotifyModel; readonly agentId: string }) {
  const level = notifyOf(useStore(props.notify.state), props.agentId);
  return (
    <div class="settings-section">
      <div class="field">
        <span>Notifications</span>
        <Segmented<AgentNotify>
          label="Notifications"
          value={level}
          options={AgentNotify.options.map((value) => ({ value, label: NOTIFY_COPY[value].label }))}
          onChange={(next) => {
            props.notify.set(props.agentId, next);
          }}
        />
      </div>
      <p class="binding-note">{NOTIFY_COPY[level].detail}</p>
    </div>
  );
}
