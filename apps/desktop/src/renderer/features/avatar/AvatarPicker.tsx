import type { AgentAvatar, AvatarFinish, AvatarShape } from '@morrowbot/contracts';
import { BotAvatar } from './BotAvatar.tsx';
import type { AvatarMotion } from './motion.ts';
import { FINISHES, finishLabel, SHAPES, shapeLabel } from './shapes.ts';

const COLORS: readonly string[] = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280'];

/** One change the picker offers. */
export type AvatarChoice =
  | { readonly kind: 'shape'; readonly shape: AvatarShape }
  | { readonly kind: 'color'; readonly color: string }
  | { readonly kind: 'finish'; readonly finish: AvatarFinish };

const pickOne = <T,>(items: readonly T[], fallback: T): T => items[Math.floor(Math.random() * items.length)] ?? fallback;

/** A new agent's starting avatar: a random shape and color, flat. */
export const freshAvatar = (): AgentAvatar => ({ kind: 'bot', shape: pickOne(SHAPES, 'chat'), color: pickOne(COLORS, '#6b7280'), finish: 'flat' });

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

/** Shape, color and finish of an agent's avatar, with a live preview. */
export function AvatarPicker(props: { readonly value: AgentAvatar; readonly onChange: (next: AgentAvatar) => void }) {
  const { value } = props;
  const pick = (choice: AvatarChoice): void => {
    const next = choose(value, choice);
    if (next.shape !== value.shape || next.color !== value.color || next.finish !== value.finish) props.onChange(next);
  };
  return (
    <div class="avatar-picker">
      <div class="avatar-preview">
        <BotAvatar avatar={value} motion={PREVIEW} size={112} label={`${shapeLabel(value.shape)} avatar, ${finishLabel(value.finish)}`} />
      </div>
      <div class="avatar-options">
        <div class="avatar-row" role="group" aria-label="Shape">
          {SHAPES.map((shape) => (
            <button
              type="button"
              key={shape}
              aria-pressed={shape === value.shape}
              class={`avatar-tile ${shape === value.shape ? 'selected' : ''}`}
              title={shapeLabel(shape)}
              aria-label={shapeLabel(shape)}
              onClick={() => { pick({ kind: 'shape', shape }); }}
            >
              <BotAvatar avatar={{ ...value, shape }} size={36} />
            </button>
          ))}
        </div>
        <div class="avatar-row" role="group" aria-label="Color">
          {COLORS.map((color) => (
            <button
              type="button"
              key={color}
              aria-pressed={color === value.color.toLowerCase()}
              aria-label={color}
              class={`swatch ${color === value.color.toLowerCase() ? 'selected' : ''}`}
              style={{ background: color }}
              onClick={() => { pick({ kind: 'color', color }); }}
            />
          ))}
          <input
            type="color"
            class="swatch-custom"
            aria-label="Custom color"
            title="Custom color"
            value={value.color.toLowerCase()}
            onChange={(event) => { pick({ kind: 'color', color: event.currentTarget.value }); }}
          />
        </div>
        <div class="segmented" role="group" aria-label="Finish">
          {FINISHES.map((finish) => (
            <button
              type="button"
              key={finish}
              aria-pressed={finish === value.finish}
              class={finish === value.finish ? 'selected' : undefined}
              onClick={() => { pick({ kind: 'finish', finish }); }}
            >
              {finishLabel(finish)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
