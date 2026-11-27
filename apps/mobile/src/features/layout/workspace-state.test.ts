import { describe, expect, it } from 'vitest';
import { foldedDuo, unfoldedDuo, unfoldedDuoWithHinge } from '../../lib/fixtures.test-support.ts';
import { deriveWorkspaceLayout } from '../../lib/layout.ts';
import type { DetailRoute } from '../../lib/workspace.ts';
import {
  deriveActionSource,
  initialWorkspaceState,
  isDetailExpanded,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from './workspace-state.ts';

const chat: DetailRoute = { kind: 'chat', agentId: 'errand-bot', threadId: null };
const connections: DetailRoute = { kind: 'settings', section: 'connections' };

function run(...actions: WorkspaceAction[]): WorkspaceState {
  return actions.reduce(workspaceReducer, initialWorkspaceState);
}

describe('workspaceReducer', () => {
  it('opens a route in the current tab when that tab can host it', () => {
    const state = run(
      { kind: 'select-tab', tab: 'threads' },
      { kind: 'open', route: chat, tabs: ['agents', 'threads'] },
    );
    expect({ tab: state.tab, selection: state.selection }).toMatchInlineSnapshot(`
      {
        "selection": {
          "agents": null,
          "extensions": null,
          "settings": null,
          "threads": {
            "agentId": "errand-bot",
            "kind": "chat",
            "threadId": null,
          },
        },
        "tab": "threads",
      }
    `);
  });

  it("switches to the route's home tab otherwise, keeping each tab's own detail", () => {
    const state = run(
      { kind: 'open', route: chat, tabs: ['agents', 'threads'] },
      { kind: 'open', route: connections, tabs: ['settings'] },
    );
    expect({ tab: state.tab, selection: state.selection }).toMatchInlineSnapshot(`
      {
        "selection": {
          "agents": {
            "agentId": "errand-bot",
            "kind": "chat",
            "threadId": null,
          },
          "extensions": null,
          "settings": {
            "kind": "settings",
            "section": "connections",
          },
          "threads": null,
        },
        "tab": "settings",
      }
    `);
  });

  it('expands only with a detail open, and closing the detail collapses it', () => {
    const noDetail = run({ kind: 'toggle-expanded' });
    const expanded = run(
      { kind: 'open', route: chat, tabs: ['agents'] },
      { kind: 'toggle-expanded' },
    );
    const closed = workspaceReducer(expanded, { kind: 'close-detail' });
    expect({
      noDetail: noDetail.detailExpanded,
      expanded: expanded.detailExpanded,
      closed: { expanded: closed.detailExpanded, agents: closed.selection.agents },
    }).toMatchInlineSnapshot(`
      {
        "closed": {
          "agents": null,
          "expanded": false,
        },
        "expanded": true,
        "noDetail": false,
      }
    `);
  });
});

describe('isDetailExpanded', () => {
  const expanded = run({ kind: 'open', route: chat, tabs: ['agents'] }, { kind: 'toggle-expanded' });

  it('fills the split only where no hinge divides it', () => {
    expect({
      folded: isDetailExpanded(deriveWorkspaceLayout(foldedDuo), expanded),
      unfolded: isDetailExpanded(deriveWorkspaceLayout(unfoldedDuo), expanded),
      hinge: isDetailExpanded(deriveWorkspaceLayout(unfoldedDuoWithHinge), expanded),
    }).toMatchInlineSnapshot(`
      {
        "folded": false,
        "hinge": false,
        "unfolded": true,
      }
    `);
  });
});

describe('deriveActionSource', () => {
  it('shows detail actions whenever a detail is on screen, list actions otherwise', () => {
    expect({
      foldedList: deriveActionSource('stack', null),
      foldedChat: deriveActionSource('stack', chat),
      unfoldedList: deriveActionSource('split', null),
      unfoldedHosts: deriveActionSource('split', connections),
    }).toMatchInlineSnapshot(`
      {
        "foldedChat": {
          "kind": "detail",
          "route": {
            "agentId": "errand-bot",
            "kind": "chat",
            "threadId": null,
          },
        },
        "foldedList": {
          "includeSearch": true,
          "kind": "list",
        },
        "unfoldedHosts": {
          "kind": "detail",
          "route": {
            "kind": "settings",
            "section": "connections",
          },
        },
        "unfoldedList": {
          "includeSearch": false,
          "kind": "list",
        },
      }
    `);
  });
});
