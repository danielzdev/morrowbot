export interface WidthBounds {
  readonly min: number;
  readonly max: number;
}

/** The panel edge the handle sits on; dragging or arrowing toward that side widens the panel. */
export type PanelEdge = 'left' | 'right';

const STEP = 8;

export function clampWidth(width: number, bounds: WidthBounds): number {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
}

/**
 * The one way to resize a panel: a vertical separator dragged with the pointer or moved with the
 * arrow keys. While a drag runs, the root carries `data-resizing` so the resize cursor holds and
 * text stays unselected wherever the pointer goes.
 */
export function ResizeHandle(props: {
  readonly class: string;
  readonly label: string;
  readonly edge: PanelEdge;
  readonly width: number;
  readonly bounds: WidthBounds;
  readonly onResize: (width: number) => void;
}) {
  const sign = props.edge === 'right' ? 1 : -1;
  const resize = (width: number): void => {
    props.onResize(clampWidth(width, props.bounds));
  };
  return (
    <div
      class={`resize-handle ${props.class}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuemin={props.bounds.min}
      aria-valuemax={props.bounds.max}
      aria-valuenow={props.width}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const handle = event.currentTarget;
        const startX = event.clientX;
        const startWidth = props.width;
        handle.setPointerCapture(event.pointerId);
        const root = document.documentElement;
        root.dataset.resizing = '';
        const move = (moved: PointerEvent): void => {
          resize(startWidth + sign * (moved.clientX - startX));
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener(
          'lostpointercapture',
          () => {
            handle.removeEventListener('pointermove', move);
            delete root.dataset.resizing;
          },
          { once: true },
        );
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') resize(props.width - sign * STEP);
        else if (event.key === 'ArrowRight') resize(props.width + sign * STEP);
        else return;
        event.preventDefault();
      }}
    />
  );
}
