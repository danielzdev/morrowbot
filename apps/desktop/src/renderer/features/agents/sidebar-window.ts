import type { AgentEntry, GroupId, SidebarGroup } from './sidebar-groups.ts';

export type SidebarItem =
  | { readonly kind: 'header'; readonly key: string; readonly group: GroupId; readonly count: number }
  | { readonly kind: 'agent'; readonly key: string; readonly entry: AgentEntry };

export const HEADER_PX = 28;
export const ROW_PX = 36;
/** Above this many agents the list renders only the rows in view (spec §3.1). */
export const VIRTUALIZE_ABOVE = 60;
const OVERSCAN_PX = 6 * ROW_PX;

/** The list's rows in order: a header per group (not in the avatar rail), then its agents. */
export function itemsOf(groups: readonly SidebarGroup[], rail: boolean): readonly SidebarItem[] {
  const items: SidebarItem[] = [];
  for (const group of groups) {
    if (!rail) items.push({ kind: 'header', key: `header-${group.id}`, group: group.id, count: group.entries.length });
    for (const entry of group.entries) items.push({ kind: 'agent', key: entry.agent.id, entry });
  }
  return items;
}

const heightOf = (item: SidebarItem): number => (item.kind === 'header' ? HEADER_PX : ROW_PX);

export interface RowWindow {
  readonly start: number;
  readonly end: number;
  readonly before: number;
  readonly after: number;
  readonly tops: readonly number[];
}

/** Which rows to render for a scroll position: all of them up to the threshold, else those in view plus a margin. */
export function windowOf(items: readonly SidebarItem[], scrollTop: number, viewport: number, agentCount: number): RowWindow {
  const tops: number[] = [];
  let total = 0;
  for (const item of items) {
    tops.push(total);
    total += heightOf(item);
  }
  if (agentCount <= VIRTUALIZE_ABOVE) return { start: 0, end: items.length, before: 0, after: 0, tops };
  const from = scrollTop - OVERSCAN_PX;
  const to = scrollTop + viewport + OVERSCAN_PX;
  let start = 0;
  while (start < items.length && (tops[start + 1] ?? total) <= from) start++;
  let end = start;
  while (end < items.length && (tops[end] ?? total) < to) end++;
  return { start, end, before: tops[start] ?? total, after: total - (tops[end] ?? total), tops };
}
