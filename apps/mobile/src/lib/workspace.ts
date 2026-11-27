import type { EntityId } from '@morrowbot/contracts';
import type { ComponentType, ReactNode } from 'react';
import type { MorrowSymbol } from './symbols.ts';

/**
 * The contract between the layout shell (`features/layout`) and the feature slices that fill it.
 * Each slice exports its slots from its own `features/<name>/index.ts`; `src/app/registry.ts`
 * wires them together, so slices never edit each other's files or the shell.
 */

export type TabKey = 'agents' | 'threads' | 'extensions' | 'settings';

export type SettingsSection = 'connections' | 'notifications' | 'appearance' | 'providers' | 'usage';

/**
 * Every detail route, by kind. Adding a kind here and a slot for it in the registry is all a new
 * detail screen needs; the shell never switches on route kinds.
 */
export interface DetailRouteMap {
  /** `threadId: null` is the agent's main thread. */
  readonly chat: { readonly agentId: EntityId; readonly threadId: EntityId | null };
  readonly settings: { readonly section: SettingsSection };
  readonly extension: { readonly extensionId: string };
}
export type DetailRouteKind = keyof DetailRouteMap;

/** What the detail column (or the pushed screen, when folded) shows. */
export type DetailRoute<K extends DetailRouteKind = DetailRouteKind> = {
  readonly [P in K]: { readonly kind: P } & DetailRouteMap[P];
}[K];

export interface WorkspaceNavigation {
  /** Shows `route` in the detail column, switching tab when the current one cannot host it. */
  readonly open: (route: DetailRoute) => void;
  /** Pops the pushed detail (folded) or clears the detail column (unfolded). */
  readonly closeDetail: () => void;
}

/** A contextual floating Liquid Glass button. */
export interface SlotAction {
  readonly id: string;
  readonly label: string;
  readonly symbol: MorrowSymbol;
  readonly onPress: (navigation: WorkspaceNavigation) => void;
}

export interface SidebarProps {
  readonly selected: DetailRoute | null;
  readonly navigation: WorkspaceNavigation;
}

export interface DetailProps<K extends DetailRouteKind> {
  readonly route: DetailRoute<K>;
  readonly navigation: WorkspaceNavigation;
}

/** A detail screen. The shell draws the header chrome around `Title` and puts `Body` below. */
export interface DetailSlot<K extends DetailRouteKind> {
  /** Tabs that can show this route; the first is where `open` goes from any other tab. */
  readonly tabs: readonly [TabKey, ...TabKey[]];
  readonly Title: ComponentType<{ readonly route: DetailRoute<K> }>;
  readonly Body: ComponentType<DetailProps<K>>;
  /** Floating actions while this route is on screen, e.g. New Thread and Agent Settings in chat. */
  readonly actions: (route: DetailRoute<K>) => readonly SlotAction[];
}

export type DetailRegistry = { readonly [K in DetailRouteKind]: DetailSlot<K> };

/** One tab of the rail: its list (the sidebar when unfolded, the root screen when folded). */
export interface TabSlot {
  readonly Sidebar: ComponentType<SidebarProps>;
  /** Floating actions while the list is on screen, e.g. New. */
  readonly actions: readonly SlotAction[];
  /** Opens search for this list, or null when the tab has none. */
  readonly onSearch: ((navigation: WorkspaceNavigation) => void) | null;
}

/** Wraps the whole app, for the host connection and anything else app-wide. */
export interface ConnectionSlot {
  readonly Provider: ComponentType<{ readonly children: ReactNode }>;
}

export interface WorkspaceRegistry {
  readonly connection: ConnectionSlot;
  readonly tabs: { readonly [K in TabKey]: TabSlot };
  readonly details: DetailRegistry;
}

/** The slot for `route`, typed to that route's kind. */
export function detailSlotFor<K extends DetailRouteKind>(
  details: DetailRegistry,
  route: DetailRoute<K>,
): DetailSlot<K> {
  return details[route.kind];
}
