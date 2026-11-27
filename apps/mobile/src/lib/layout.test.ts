import { describe, expect, it } from 'vitest';
import { foldedDuo, standardIPhone, unfoldedDuo, unfoldedDuoWithHinge } from './fixtures.test-support.ts';
import { deriveActionSlotPlacement, deriveWorkspaceLayout } from './layout.ts';
import type { NativeLayoutMetrics } from './reserved-regions.ts';

describe('deriveWorkspaceLayout', () => {
  it('stacks one column on folded and standard iPhones', () => {
    expect({
      beforeMetrics: deriveWorkspaceLayout(null),
      standardIPhone: deriveWorkspaceLayout(standardIPhone),
      foldedDuo: deriveWorkspaceLayout(foldedDuo),
    }).toMatchInlineSnapshot(`
      {
        "beforeMetrics": {
          "contentInsets": {
            "left": 0,
            "right": 0,
          },
          "kind": "stack",
        },
        "foldedDuo": {
          "contentInsets": {
            "left": 0,
            "right": 76,
          },
          "kind": "stack",
        },
        "standardIPhone": {
          "contentInsets": {
            "left": 0,
            "right": 0,
          },
          "kind": "stack",
        },
      }
    `);
  });

  it('splits an unfolded iPhone Duo with a clamped sidebar and an expandable detail', () => {
    expect(deriveWorkspaceLayout(unfoldedDuo)).toMatchInlineSnapshot(`
      {
        "canExpandDetail": true,
        "detailWidth": 564,
        "gap": 0,
        "hingeAligned": false,
        "kind": "split",
        "sidebarWidth": 317,
      }
    `);
  });

  it('meets the columns on an active hinge and keeps the detail off it', () => {
    expect(deriveWorkspaceLayout(unfoldedDuoWithHinge)).toMatchInlineSnapshot(`
      {
        "canExpandDetail": false,
        "detailWidth": 435,
        "gap": 10,
        "hingeAligned": true,
        "kind": "split",
        "sidebarWidth": 436,
      }
    `);
  });

  it('falls back to one hinge-safe column when the hinge leaves no room for a sidebar', () => {
    const lopsided: NativeLayoutMetrics = {
      ...unfoldedDuo,
      reservedRegions: [{ kind: 'division', x: 200, y: 0, width: 10, height: 669 }],
    };
    expect(deriveWorkspaceLayout(lopsided)).toMatchInlineSnapshot(`
      {
        "contentInsets": {
          "left": 210,
          "right": 70,
        },
        "kind": "stack",
      }
    `);
  });

  it('never puts split content across a division', () => {
    for (let x = 0; x <= unfoldedDuo.width; x += 7) {
      const metrics: NativeLayoutMetrics = {
        ...unfoldedDuo,
        reservedRegions: [{ kind: 'division', x, y: 0, width: 10, height: unfoldedDuo.height }],
      };
      const layout = deriveWorkspaceLayout(metrics);
      if (layout.kind !== 'split') continue;
      const room = { start: metrics.safeArea.left, end: metrics.width - metrics.safeArea.right };
      const crosses = (start: number, end: number) => Math.min(end, x + 10) > Math.max(start, x);
      const sidebarEnd = room.start + layout.sidebarWidth;
      const detailStart = sidebarEnd + layout.gap;
      expect(crosses(room.start, sidebarEnd)).toBe(false);
      expect(crosses(detailStart, detailStart + layout.detailWidth)).toBe(false);
      expect(detailStart + layout.detailWidth).toBe(room.end);
      if (layout.canExpandDetail) expect(crosses(room.start, room.end)).toBe(false);
    }
  });
});

describe('deriveActionSlotPlacement', () => {
  it('puts actions in the vertical bar below the status block on iPhone Duo', () => {
    expect({
      foldedDuo: deriveActionSlotPlacement(foldedDuo),
      unfoldedDuo: deriveActionSlotPlacement(unfoldedDuo),
    }).toMatchInlineSnapshot(`
      {
        "foldedDuo": {
          "barWidth": 76,
          "edge": "right",
          "kind": "vertical-bar",
          "top": 256,
        },
        "unfoldedDuo": {
          "barWidth": 70,
          "edge": "right",
          "kind": "vertical-bar",
          "top": 246,
        },
      }
    `);
  });

  it('floats actions above the bottom tab bar elsewhere', () => {
    expect({
      beforeMetrics: deriveActionSlotPlacement(null),
      standardIPhone: deriveActionSlotPlacement(standardIPhone),
    }).toMatchInlineSnapshot(`
      {
        "beforeMetrics": {
          "bottom": 16,
          "kind": "floating",
          "right": 16,
        },
        "standardIPhone": {
          "bottom": 102,
          "kind": "floating",
          "right": 16,
        },
      }
    `);
  });
});
