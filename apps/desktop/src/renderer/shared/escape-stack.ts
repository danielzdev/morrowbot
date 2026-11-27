/** Something focus can go back to: a trigger button, or whatever had focus before a layer opened. */
export interface Focusable {
  focus(): void;
  readonly isConnected: boolean;
}

/** An open popover, menu or modal. */
export interface Layer {
  /** Asks the layer to close. It may decline (a form asking "Discard?"): a layer leaves the stack only when it is removed. */
  readonly close: () => void;
  /** Where focus goes when the layer closes. */
  readonly returnFocus: Focusable | null;
  /** True when a pointer press at this target is inside the layer (or its trigger), so it stays open. */
  readonly contains: (target: unknown) => boolean;
}

export interface EscapeStack {
  /** Opens a layer on top; the returned function removes it (call it on unmount) and returns focus if it was on top. */
  push(layer: Layer): () => void;
  /** Esc: asks only the topmost layer to close. Returns whether a layer took the key. */
  escape(): boolean;
  /** A pointer press: asks the topmost layer to close when the press is outside it. */
  pointerDown(target: unknown): boolean;
  readonly depth: number;
}

/** One stack for every overlay (spec §1.5): Esc closes the topmost layer and focus returns to its trigger. */
export function createEscapeStack(): EscapeStack {
  const layers: Layer[] = [];
  const remove = (layer: Layer): void => {
    const index = layers.indexOf(layer);
    if (index === -1) return;
    layers.splice(index, 1);
    if (index === layers.length && layer.returnFocus?.isConnected === true) layer.returnFocus.focus();
  };
  const closeTop = (): boolean => {
    const top = layers.at(-1);
    if (top === undefined) return false;
    top.close();
    return true;
  };
  return {
    push(layer) {
      layers.push(layer);
      return () => {
        remove(layer);
      };
    },
    escape: closeTop,
    pointerDown(target) {
      const top = layers.at(-1);
      if (top === undefined || top.contains(target)) return false;
      return closeTop();
    },
    get depth() {
      return layers.length;
    },
  };
}

/** The window's stack; `Shell` feeds it Esc and pointer presses. */
export const escapeStack = createEscapeStack();
