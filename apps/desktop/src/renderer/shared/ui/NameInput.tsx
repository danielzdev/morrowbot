import { useState } from 'preact/hooks';

/** An inline name field: Enter or blur saves, Esc cancels; an empty or unchanged name saves nothing. */
export function NameInput(props: {
  readonly initial: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly onDone: (name: string | null) => void;
}) {
  const [name, setName] = useState(props.initial);
  return (
    <input
      class="row-rename"
      aria-label={props.label}
      placeholder={props.placeholder}
      value={name}
      ref={(input) => input?.focus()}
      onInput={(event) => {
        setName(event.currentTarget.value);
      }}
      onBlur={() => {
        props.onDone(name.trim() === '' || name.trim() === props.initial ? null : name.trim());
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') props.onDone(null);
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
