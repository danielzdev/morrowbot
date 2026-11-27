import type { Agent } from '@morrowbot/contracts';
import { useState } from 'preact/hooks';

/** Inline rename in a sidebar row: Enter or blur saves, Esc cancels; an empty or unchanged name saves nothing. */
export function RowRename(props: { readonly agent: Agent; readonly onDone: (name: string | null) => void }) {
  const [name, setName] = useState(props.agent.name);
  return (
    <input
      class="row-rename"
      aria-label={`Rename ${props.agent.name}`}
      value={name}
      ref={(input) => input?.focus()}
      onInput={(event) => {
        setName(event.currentTarget.value);
      }}
      onBlur={() => {
        props.onDone(name.trim() === '' || name.trim() === props.agent.name ? null : name.trim());
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') props.onDone(null);
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
