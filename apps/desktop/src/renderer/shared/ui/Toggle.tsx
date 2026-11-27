/** An on/off switch. `label` is its accessible name; the visible label sits beside it in a settings row. */
export function Toggle(props: { readonly label: string; readonly checked: boolean; readonly disabled?: boolean; readonly onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      class="switch"
      onClick={() => {
        props.onChange(!props.checked);
      }}
    >
      <span class="switch-knob" />
    </button>
  );
}
