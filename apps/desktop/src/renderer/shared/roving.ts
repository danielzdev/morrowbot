/** Where a roving-tabindex list (spec §1.5) moves on a key, or null when the key is not a move. */
export function rovingTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return index < 0 ? 0 : Math.min(index + 1, count - 1);
    case 'ArrowUp':
      return index < 0 ? count - 1 : Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** The first label after `from` (wrapping) that starts with `prefix`, ignoring case; -1 when none does. */
export function typeAheadTarget(labels: readonly string[], prefix: string, from: number): number {
  const wanted = prefix.toLocaleLowerCase();
  if (wanted === '') return -1;
  for (let step = 1; step <= labels.length; step++) {
    const index = (from + step + labels.length) % labels.length;
    if (labels[index]?.toLocaleLowerCase().startsWith(wanted) === true) return index;
  }
  return -1;
}

const TYPE_AHEAD_MS = 700;
const buffers = new WeakMap<object, { text: string; at: number }>();

/** True for a key that should extend the type-ahead buffer: one printable character with no modifier. */
const isTypeAhead = (event: KeyboardEvent): boolean => event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey;

/**
 * Handles ↑/↓/Home/End and type-ahead for the `[data-roving]` items inside `list`.
 * Focused item gets tabindex 0, the rest -1. Returns whether the key was used.
 */
export function handleRovingKey(event: KeyboardEvent, list: HTMLElement): boolean {
  const items = [...list.querySelectorAll<HTMLElement>('[data-roving]')].filter((item) => !item.hasAttribute('disabled'));
  const current = items.findIndex((item) => item === document.activeElement || item.contains(document.activeElement));
  let next = rovingTarget(event.key, current, items.length);
  if (next === null && isTypeAhead(event)) {
    const now = event.timeStamp;
    const previous = buffers.get(list);
    const text = previous !== undefined && now - previous.at < TYPE_AHEAD_MS ? previous.text + event.key : event.key;
    buffers.set(list, { text, at: now });
    const found = typeAheadTarget(items.map((item) => item.dataset.roving ?? item.textContent), text, text.length > 1 ? current - 1 : current);
    next = found === -1 ? null : found;
  }
  if (next === null) return false;
  event.preventDefault();
  focusRoving(items, next);
  return true;
}

/** Makes item `index` the list's one tab stop and focuses it. */
export function focusRoving(items: readonly HTMLElement[], index: number): void {
  items.forEach((item, at) => {
    item.tabIndex = at === index ? 0 : -1;
  });
  items[index]?.focus();
}
