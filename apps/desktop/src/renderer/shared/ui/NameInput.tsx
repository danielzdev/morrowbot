import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** An inline name field: Enter or blur saves, Esc cancels; an empty or unchanged name saves nothing. It finishes once. */
export function NameInput(props: {
  readonly initial: string;
  readonly label: string;
  readonly maxLength: number;
  readonly placeholder?: string;
  readonly onDone: (name: string | null) => void;
}) {
  const [name, setName] = useState(props.initial);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (value: string | null): void => {
    if (done.current) return;
    done.current = true;
    props.onDone(value);
  };
  useLayoutEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <input
      ref={input}
      class="row-rename"
      aria-label={props.label}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      value={name}
      onInput={(event) => {
        setName(event.currentTarget.value);
      }}
      onBlur={() => {
        finish(name.trim() === '' || name.trim() === props.initial ? null : name.trim());
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') finish(null);
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
