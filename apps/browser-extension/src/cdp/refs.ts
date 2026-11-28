import type { ElementRef } from '@morrowbot/contracts';
import { BrowserFailure } from './session.ts';

/** The element refs of a tab's latest snapshot, each pointing at a DOM node (`backendDOMNodeId`). */
export type RefTable = ReadonlyMap<ElementRef, number>;

export function nodeOf(refs: RefTable, ref: ElementRef): number {
  const node = refs.get(ref);
  if (node === undefined) throw new BrowserFailure('stale-ref', `${ref} is not in this tab's latest snapshot. Take a new snapshot.`);
  return node;
}
