import type { WorkspaceLayout } from '../../lib/layout.ts';
import type { DetailRoute, TabKey } from '../../lib/workspace.ts';

export interface WorkspaceState {
  readonly tab: TabKey;
  /** Each tab remembers its own detail, like a native tab keeps its own stack. */
  readonly selection: { readonly [K in TabKey]: DetailRoute | null };
  /** The `⤢` toggle: the detail column takes the whole width. */
  readonly detailExpanded: boolean;
}

export type WorkspaceAction =
  | { readonly kind: 'select-tab'; readonly tab: TabKey }
  | {
      readonly kind: 'open';
      readonly route: DetailRoute;
      readonly tabs: readonly [TabKey, ...TabKey[]];
    }
  | { readonly kind: 'close-detail' }
  | { readonly kind: 'toggle-expanded' };

export const initialWorkspaceState: WorkspaceState = {
  tab: 'agents',
  selection: { agents: null, threads: null, extensions: null, settings: null },
  detailExpanded: false,
};

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.kind) {
    case 'select-tab':
      return action.tab === state.tab ? state : { ...state, tab: action.tab };
    case 'open': {
      const tab = action.tabs.includes(state.tab) ? state.tab : action.tabs[0];
      return { ...state, tab, selection: { ...state.selection, [tab]: action.route } };
    }
    case 'close-detail':
      return {
        ...state,
        selection: { ...state.selection, [state.tab]: null },
        detailExpanded: false,
      };
    case 'toggle-expanded':
      return state.selection[state.tab] === null
        ? state
        : { ...state, detailExpanded: !state.detailExpanded };
  }
}

export function visibleDetail(state: WorkspaceState): DetailRoute | null {
  return state.selection[state.tab];
}

/** Whether the detail currently fills the split; never across a hinge, never with no detail. */
export function isDetailExpanded(layout: WorkspaceLayout, state: WorkspaceState): boolean {
  switch (layout.kind) {
    case 'stack':
      return false;
    case 'split':
      return layout.canExpandDetail && state.detailExpanded && visibleDetail(state) !== null;
  }
}

/**
 * Which slot supplies the floating actions.
 * - `detail`: a detail is on screen, so its route's actions show (New Thread, Agent Settings…).
 * - `list`: only the list is on screen. Folded, Search joins the tab's actions; unfolded, Search
 *   is the pill at the bottom of the sidebar instead.
 */
export type ActionSource =
  | { readonly kind: 'detail'; readonly route: DetailRoute }
  | { readonly kind: 'list'; readonly includeSearch: boolean };

export function deriveActionSource(
  layout: WorkspaceLayout['kind'],
  route: DetailRoute | null,
): ActionSource {
  if (route) return { kind: 'detail', route };
  switch (layout) {
    case 'stack':
      return { kind: 'list', includeSearch: true };
    case 'split':
      return { kind: 'list', includeSearch: false };
  }
}
