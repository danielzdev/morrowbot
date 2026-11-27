import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Modal } from './Modal.tsx';

/**
 * The in-app confirm (there is no `window.confirm` anywhere). Cancel has focus first; with
 * `typeToConfirm`, the confirm button waits until that exact text is typed.
 */
export function ConfirmDialog(props: {
  readonly title: string;
  readonly body: ComponentChildren;
  readonly confirmLabel: string;
  readonly tone: 'danger' | 'primary';
  readonly typeToConfirm?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ready = props.typeToConfirm === undefined || typed === props.typeToConfirm;
  return (
    <Modal label={props.title} role="alertdialog" class="confirm" onClose={props.onCancel}>
      <form
        class="confirm-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) props.onConfirm();
        }}
      >
        <h2 class="dialog-title">{props.title}</h2>
        <div class="dialog-body">{props.body}</div>
        {props.typeToConfirm !== undefined && (
          <label class="field">
            <span>
              Type <strong>{props.typeToConfirm}</strong> to confirm
            </span>
            <input
              type="text"
              data-autofocus
              spellcheck={false}
              autocomplete="off"
              value={typed}
              onInput={(event) => {
                setTyped(event.currentTarget.value);
              }}
            />
          </label>
        )}
        <div class="dialog-actions">
          <button type="button" class="btn secondary" data-autofocus={props.typeToConfirm === undefined ? true : undefined} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" class={`btn ${props.tone}`} disabled={!ready}>
            {props.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
