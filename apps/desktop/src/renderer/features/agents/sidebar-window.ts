import { sectionKey, type AgentEntry, type Section, type SidebarGroup } from './sidebar-groups.ts';

export type SidebarItem =
  | { readonly kind: 'header'; readonly key: string; readonly section: Section; readonly count: number; readonly collapsed: boolean }
  | { readonly kind: 'agent'; readonly key: string; readonly entry: AgentEntry }
  | { readonly kind: 'empty'; readonly key: string };

export const HEADER_PX = 36;
export const ROW_PX = 64;
export const RAIL_ROW_PX = 48;
export const EMPTY_PX = 32;
/** Above this many agents the list renders only the rows in view (spec §3.1). */
export const VIRTUALIZE_ABOVE = 60;
const OVERSCAN = 6;

/** Sections a person may fold away; the status sections always stay open. */
export const collapsible = (section: Section): boolean => section.kind === 'agents' || section.kind === 'folder';

/**
 * The list's rows in order: a header per section, then its agents, or a note in an empty folder.
 * The avatar rail has no headers and shows every agent, folded sections included.
 */
export function itemsOf(groups: readonly SidebarGroup[], rail: boolean, collapsed: ReadonlySet<string>): readonly SidebarItem[] {
  const items: SidebarItem[] = [];
  for (const group of groups) {
    const key = sectionKey(group.section);
    const folded = !rail && collapsible(group.section) && collapsed.has(key);
    if (!rail) items.push({ kind: 'header', key: `header-${key}`, section: group.section, count: group.entries.length, collapsed: folded });
    if (folded) continue;
    for (const entry of group.entries) items.push({ kind: 'agent', key: entry.agent.id, entry });
    if (!rail && group.entries.length === 0 && group.section.kind === 'folder') items.push({ kind: 'empty', key: `empty-${key}` });
  }
  return items;
}

export interface RowWindow {
  readonly start: number;
  readonly end: number;
  readonly before: number;
  readonly after: number;
  readonly tops: readonly number[];
  readonly rowPx: number;
}

/** Which rows to render for a scroll position: all of them up to the threshold, else those in view plus a margin. */
export function windowOf(items: readonly SidebarItem[], scrollTop: number, viewport: number, agentCount: number, rail: boolean): RowWindow {
  const rowPx = rail ? RAIL_ROW_PX : ROW_PX;
  const heightOf = (item: SidebarItem): number => {
    switch (item.kind) {
      case 'header':
        return HEADER_PX;
      case 'agent':
        return rowPx;
      case 'empty':
        return EMPTY_PX;
    }
  };
  const tops: number[] = [];
  let total = 0;
  for (const item of items) {
    tops.push(total);
    total += heightOf(item);
  }
  if (agentCount <= VIRTUALIZE_ABOVE) return { start: 0, end: items.length, before: 0, after: 0, tops, rowPx };
  const from = scrollTop - OVERSCAN * rowPx;
  const to = scrollTop + viewport + OVERSCAN * rowPx;
  let start = 0;
  while (start < items.length && (tops[start + 1] ?? total) <= from) start++;
  let end = start;
  while (end < items.length && (tops[end] ?? total) < to) end++;
  return { start, end, before: tops[start] ?? total, after: total - (tops[end] ?? total), tops, rowPx };
}
