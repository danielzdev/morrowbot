import { useEffect, useRef, useState } from 'preact/hooks';
import {
  BUBBLE_SWATCHES,
  bubbleStyleVars,
  normalizeHex,
  type BubbleColorGlobal,
  type BubbleColorOverride,
  type HexColor,
} from '../bubble-color.ts';

const STEP: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Curated color swatches with roving arrow navigation, plus a native color picker and `#rrggbb` text
 * input so users can pick any preset or exact hex value.
 */
export function BubbleColorPicker(props: {
  readonly label: string;
  readonly value: HexColor;
  readonly onChange: (color: HexColor) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const current = props.value.toLowerCase();
  const [draft, setDraft] = useState(current);
  useEffect(() => {
    setDraft(current);
  }, [current]);

  const at = BUBBLE_SWATCHES.findIndex((swatch) => swatch.color === current);
  const customSelected = at === -1;

  return (
    <div class="bubble-color-picker">
      <div
        ref={row}
        role="radiogroup"
        aria-label={props.label}
        class="bubble-swatches"
        onKeyDown={(event) => {
          const step = STEP[event.key];
          if (step === undefined || !(event.target instanceof HTMLButtonElement)) return;
          event.preventDefault();
          const next = BUBBLE_SWATCHES[(Math.max(at, 0) + step + BUBBLE_SWATCHES.length) % BUBBLE_SWATCHES.length];
          if (next === undefined) return;
          props.onChange(next.color);
          row.current?.querySelector<HTMLElement>(`[data-swatch="${next.color}"]`)?.focus();
        }}
      >
        {BUBBLE_SWATCHES.map((swatch, index) => {
          const checked = swatch.color === current;
          return (
            <button
              key={swatch.color}
              type="button"
              data-swatch={swatch.color}
              role="radio"
              aria-checked={checked}
              aria-label={swatch.name}
              title={`${swatch.name} (${swatch.color})`}
              tabIndex={checked || (at === -1 && index === 0) ? 0 : -1}
              class={`swatch${checked ? ' selected' : ''}`}
              style={{ background: swatch.color }}
              onClick={() => {
                props.onChange(swatch.color);
              }}
            />
          );
        })}
        <input
          type="color"
          class={`swatch-custom${customSelected ? ' selected' : ''}`}
          aria-label={`${props.label} picker`}
          title="Pick a custom color"
          value={current}
          onInput={(event) => {
            const next = normalizeHex(event.currentTarget.value);
            if (next !== null) props.onChange(next);
          }}
        />
      </div>
      <input
        type="text"
        class="bubble-hex-input mono"
        aria-label={`${props.label} hex`}
        placeholder="#0ea5e9"
        maxLength={7}
        spellcheck={false}
        value={draft}
        onInput={(event) => {
          const nextText = event.currentTarget.value;
          setDraft(nextText);
          const parsed = normalizeHex(nextText);
          if (parsed !== null) props.onChange(parsed);
        }}
        onBlur={() => {
          setDraft(current);
        }}
      />
    </div>
  );
}

/** Compact live preview of how an outgoing user bubble looks in the active light or dark theme. */
export function BubblePreview(props: {
  readonly global: BubbleColorGlobal;
  readonly agentOverride?: BubbleColorOverride;
  readonly agentColor: string;
  readonly caption: string;
  readonly sampleText?: string;
}) {
  const vars = bubbleStyleVars({
    global: props.global,
    agentOverride: props.agentOverride,
    agentColor: props.agentColor,
  });
  const dotColor =
    props.agentOverride?.kind === 'custom'
      ? props.agentOverride.color
      : props.agentOverride?.kind === 'off'
        ? null
        : props.global.kind === 'custom'
          ? props.global.color
          : props.global.kind === 'match-bot'
            ? normalizeHex(props.agentColor)
            : null;
  return (
    <div class="bubble-preview" style={vars}>
      <span class="bubble-preview-caption">
        {dotColor !== null && <span class="bubble-preview-dot" style={{ background: dotColor }} aria-hidden="true" />}
        {props.caption}
      </span>
      <span class="bubble-preview-sample">{props.sampleText ?? "Looks good, let's ship it!"}</span>
    </div>
  );
}
