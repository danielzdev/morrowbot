import { useRef } from 'preact/hooks';
import { Icon, type IconName } from './Icon.tsx';

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
}

const NEXT: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** A radio group drawn as segments: one tab stop, arrows move and select, disabled segments are skipped. */
export function Segmented<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentOption<T>[];
  readonly onChange: (value: T) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = props.options.filter((option) => option.disabled !== true);
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={props.label}
      class="segmented"
      onKeyDown={(event) => {
        const step = NEXT[event.key];
        if (step === undefined || enabled.length === 0) return;
        event.preventDefault();
        const at = enabled.findIndex((option) => option.value === props.value);
        const next = enabled[(at + step + enabled.length) % enabled.length];
        if (next === undefined) return;
        props.onChange(next.value);
        group.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
      }}
    >
      {props.options.map((option) => {
        const checked = option.value === props.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={option.value}
            disabled={option.disabled}
            tabIndex={checked ? 0 : -1}
            class="segment"
            onClick={() => {
              props.onChange(option.value);
            }}
          >
            {option.icon !== undefined && <Icon name={option.icon} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
