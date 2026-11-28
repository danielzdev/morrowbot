import type { AgentAvatar, AvatarFinish, AvatarShape } from '@morrowbot/contracts';
import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import { BotAvatar } from './BotAvatar.tsx';
import type { AvatarMotion } from './motion.ts';
import { AVATARS, avatarEntry, finishLabel, FINISHES, SWATCHES } from './registry.ts';

/** One change the picker offers. */
export type AvatarChoice =
  | { readonly kind: 'shape'; readonly shape: AvatarShape }
  | { readonly kind: 'color'; readonly color: string }
  | { readonly kind: 'finish'; readonly finish: AvatarFinish };

const pickOne = <T,>(items: readonly T[], fallback: T): T => items[Math.floor(Math.random() * items.length)] ?? fallback;

/** A new agent's starting avatar: a random shape and swatch, flat. */
export const freshAvatar = (): AgentAvatar => ({
  kind: 'bot',
  shape: pickOne(AVATARS, AVATARS[0])?.id ?? 'chat',
  color: pickOne(SWATCHES, SWATCHES[0])?.color ?? '#6b7280',
  finish: 'flat',
});

export function choose(avatar: AgentAvatar, choice: AvatarChoice): AgentAvatar {
  switch (choice.kind) {
    case 'shape':
      return { ...avatar, shape: choice.shape };
    case 'color':
      return { ...avatar, color: choice.color.toLowerCase() };
    case 'finish':
      return { ...avatar, finish: choice.finish };
  }
}

const PREVIEW: AvatarMotion = { state: 'idle', mood: 'happy', paused: false };

const STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** A radio group whose arrows move and select, wrapping (one tab stop: the checked item). */
function RadioRow<T>(props: {
  readonly label: string;
  readonly class: string;
  readonly items: readonly T[];
  readonly checked: (item: T) => boolean;
  readonly keyOf: (item: T) => string;
  readonly onPick: (item: T) => void;
  readonly render: (item: T, checked: boolean) => { readonly name: string; readonly class?: string; readonly style?: Record<string, string>; readonly children?: ComponentChildren };
  readonly after?: ComponentChildren;
}) {
  const row = useRef<HTMLDivElement>(null);
  const at = props.items.findIndex(props.checked);
  return (
    <div
      ref={row}
      role="radiogroup"
      aria-label={props.label}
      class={props.class}
      onKeyDown={(event) => {
        const step = STEP[event.key];
        if (step === undefined || !(event.target instanceof HTMLButtonElement)) return;
        event.preventDefault();
        const next = props.items[(Math.max(at, 0) + step + props.items.length) % props.items.length];
        if (next === undefined) return;
        props.onPick(next);
        row.current?.querySelector<HTMLElement>(`[data-key="${props.keyOf(next)}"]`)?.focus();
      }}
    >
      {props.items.map((item, index) => {
        const checked = props.checked(item);
        const shown = props.render(item, checked);
        return (
          <button
            type="button"
            key={props.keyOf(item)}
            data-key={props.keyOf(item)}
            role="radio"
            aria-checked={checked}
            aria-label={shown.name}
            title={shown.name}
            tabIndex={checked || (at === -1 && index === 0) ? 0 : -1}
            class={shown.class}
            style={shown.style}
            onClick={() => {
              props.onPick(item);
            }}
          >
            {shown.children}
          </button>
        );
      })}
      {props.after}
    </div>
  );
}

/**
 * Shape, colour and finish of an agent's avatar (spec §5.3): only the preview animates; the shape
 * thumbnails are static icons named by tooltip and accessible name; named swatches plus a custom colour.
 */
export function AvatarPicker(props: {
  readonly value: AgentAvatar;
  readonly onChange: (next: AgentAvatar) => void;
  readonly previewSize?: number;
  readonly reducedMotion?: boolean;
}) {
  const { value } = props;
  const color = value.color.toLowerCase();
  const pick = (choice: AvatarChoice): void => {
    const next = choose(value, choice);
    if (next.shape !== value.shape || next.color !== value.color || next.finish !== value.finish) props.onChange(next);
  };
  const shapeName = avatarEntry(value.shape)?.label ?? 'Unknown shape';
  return (
    <div class="avatar-picker">
      <div class="avatar-preview">
        <BotAvatar
          avatar={value}
          motion={PREVIEW}
          size={props.previewSize ?? 96}
          label={`${shapeName} avatar, ${finishLabel(value.finish)}`}
          {...(props.reducedMotion === undefined ? {} : { reducedMotion: props.reducedMotion })}
        />
      </div>
      <div class="avatar-options">
        <RadioRow
          label="Shape"
          class="avatar-shapes"
          items={AVATARS}
          keyOf={({ id }) => id}
          checked={({ id }) => id === value.shape}
          onPick={({ id }) => {
            pick({ kind: 'shape', shape: id });
          }}
          render={({ id, label }, checked) => ({
            name: label,
            class: `avatar-tile ${checked ? 'selected' : ''}`,
            children: <BotAvatar avatar={{ ...value, shape: id }} size={32} />,
          })}
        />
        <RadioRow
          label="Colour"
          class="avatar-swatches"
          items={SWATCHES}
          keyOf={({ color: each }) => each}
          checked={({ color: each }) => each === color}
          onPick={({ color: each }) => {
            pick({ kind: 'color', color: each });
          }}
          render={({ name, color: each }, checked) => ({ name, class: `swatch ${checked ? 'selected' : ''}`, style: { background: each } })}
          after={
            <input
              type="color"
              class={`swatch-custom ${SWATCHES.some((swatch) => swatch.color === color) ? '' : 'selected'}`}
              aria-label="Custom colour"
              title="Custom colour"
              value={color}
              onChange={(event) => {
                pick({ kind: 'color', color: event.currentTarget.value });
              }}
            />
          }
        />
        <Segmented<AvatarFinish>
          label="Finish"
          value={value.finish}
          options={FINISHES.map((finish) => ({ value: finish, label: finishLabel(finish) }))}
          onChange={(finish) => {
            pick({ kind: 'finish', finish });
          }}
        />
      </div>
    </div>
  );
}
