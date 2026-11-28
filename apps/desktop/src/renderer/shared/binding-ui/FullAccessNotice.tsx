import { Modal } from '../ui/Modal.tsx';
import { FULL_ACCESS_WARNING } from './access-copy.ts';

/**
 * Said once, right after an agent gets full access (created with it, or switched to it); the chat
 * never repeats it. Got it, Esc or the scrim close it.
 */
export function FullAccessNotice(props: { readonly agentName: string; readonly onClose: () => void }) {
  const title = `${props.agentName} has full access`;
  return (
    <Modal label={title} class="confirm" onClose={props.onClose}>
      <div class="confirm-form">
        <h2 class="dialog-title">{title}</h2>
        <div class="dialog-body">
          <p>{FULL_ACCESS_WARNING}</p>
          <p class="muted">Change it any time in this agent's settings, under Permissions.</p>
        </div>
        <div class="dialog-actions">
          <button type="button" class="btn primary" data-autofocus onClick={props.onClose}>Got it</button>
        </div>
      </div>
    </Modal>
  );
}
