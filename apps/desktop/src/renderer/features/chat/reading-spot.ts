/** The first message at or below the top of the chat, and how far below the top it sits. */
export interface ReadingSpot {
  readonly id: string;
  readonly offset: number;
}

const ITEM = '[data-message-id]';

export function readingSpot(box: HTMLElement): ReadingSpot | null {
  const top = box.getBoundingClientRect().top;
  for (const item of box.querySelectorAll<HTMLElement>(ITEM)) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom > top) return { id: item.dataset.messageId ?? '', offset: rect.top - top };
  }
  return null;
}

/**
 * Scrolls so the spot's message sits where it was. Messages use `content-visibility: auto`, so ones
 * added above settle to their real height a frame later: callers restore again after that frame.
 */
export function restoreSpot(box: HTMLElement, spot: ReadingSpot): void {
  const item = box.querySelector(`[data-message-id="${CSS.escape(spot.id)}"]`);
  if (item === null) return;
  box.scrollTop += item.getBoundingClientRect().top - box.getBoundingClientRect().top - spot.offset;
}
