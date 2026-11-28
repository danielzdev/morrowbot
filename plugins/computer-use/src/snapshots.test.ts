import { describe, expect, it } from 'vitest';
import type { AxElement, WindowState } from './protocol.ts';
import { Snapshots, spaceOf, toGlobal, toLocal } from './snapshots.ts';

const button: AxElement = {
  path: [0, 2],
  depth: 2,
  role: 'AXButton',
  subrole: null,
  title: 'Save',
  value: null,
  description: null,
  frame: { x: 1780, y: 1000, width: 80, height: 30 },
  enabled: true,
  focused: false,
  actions: ['AXPress'],
};

function windowState(windowId: number, image: { width: number; height: number } | null): WindowState {
  return {
    window: { windowId, pid: 42, app: 'Notes', title: 'Groceries', frame: { x: 680, y: 256, width: 1200, height: 800 } },
    elements: [{ ...button, path: [], depth: 0, role: 'AXWindow', frame: { x: 680, y: 256, width: 1200, height: 800 } }, button],
    truncated: false,
    image: image === null ? null : { base64: 'iVBORw0KGgo=', ...image },
  };
}

describe('coordinate mapping', () => {
  it('maps screenshot pixels to screen points and back', () => {
    // A 1200×800-point window at (680, 256), captured at 960×640: one pixel is 1.25 points.
    const space = spaceOf({ x: 680, y: 256, width: 1200, height: 800 }, { width: 960, height: 640 });
    expect({
      space,
      centre: toGlobal(space, { x: 480, y: 320 }),
      corner: toGlobal(space, { x: 0, y: 0 }),
      button: toLocal(space, { x: 1780, y: 1000, width: 80, height: 30 }),
    }).toMatchInlineSnapshot(`
      {
        "button": {
          "height": 24,
          "width": 64,
          "x": 880,
          "y": 595,
        },
        "centre": {
          "x": 1280,
          "y": 656,
        },
        "corner": {
          "x": 680,
          "y": 256,
        },
        "space": {
          "height": 640,
          "originX": 680,
          "originY": 256,
          "scaleX": 1.25,
          "scaleY": 1.25,
          "width": 960,
        },
      }
    `);
  });

  it('uses window points when there is no screenshot', () => {
    const space = spaceOf({ x: 680, y: 256, width: 1200, height: 800 }, null);
    expect(toGlobal(space, { x: 10, y: 20 })).toMatchInlineSnapshot(`
      {
        "x": 690,
        "y": 276,
      }
    `);
  });
});

describe('Snapshots.resolve', () => {
  it('refuses points outside the snapshot', () => {
    const snapshots = new Snapshots();
    snapshots.addWindow(windowState(7, { width: 960, height: 640 }));
    expect([
      snapshots.resolve({ snapshot: 's1', x: 959, y: 639 }),
      snapshots.resolve({ snapshot: 's1', x: 960, y: 10 }),
      snapshots.resolve({ snapshot: 's1', x: -1, y: 10 }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "target",
          "target": {
            "check": {
              "kind": "window",
              "windowFrame": {
                "height": 800,
                "width": 1200,
                "x": 680,
                "y": 256,
              },
              "windowId": 7,
            },
            "point": {
              "x": 1878.75,
              "y": 1054.75,
            },
          },
        },
        {
          "kind": "refused",
          "reason": "(960, 10) is outside snapshot s1, whose coordinates run x 0–959, y 0–639.",
        },
        {
          "kind": "refused",
          "reason": "(-1, 10) is outside snapshot s1, whose coordinates run x 0–959, y 0–639.",
        },
      ]
    `);
  });

  it('turns a ref into the element centre plus the check the helper re-runs', () => {
    const snapshots = new Snapshots();
    snapshots.addWindow(windowState(7, null));
    expect(snapshots.resolve({ ref: 's1/e2' })).toMatchInlineSnapshot(`
      {
        "kind": "target",
        "target": {
          "check": {
            "frame": {
              "height": 30,
              "width": 80,
              "x": 1780,
              "y": 1000,
            },
            "kind": "element",
            "path": [
              0,
              2,
            ],
            "role": "AXButton",
            "windowFrame": {
              "height": 800,
              "width": 1200,
              "x": 680,
              "y": 256,
            },
            "windowId": 7,
          },
          "point": {
            "x": 1820,
            "y": 1015,
          },
        },
      }
    `);
  });

  it('refuses refs and points from a snapshot a newer one of the same window replaced', () => {
    const snapshots = new Snapshots();
    snapshots.addWindow(windowState(7, null));
    snapshots.addWindow(windowState(8, null));
    snapshots.addWindow(windowState(7, null));
    expect([
      snapshots.resolve({ ref: 's1/e2' }),
      snapshots.resolve({ snapshot: 's1', x: 1, y: 1 }),
      snapshots.resolve({ ref: 's2/e2' }).kind,
      snapshots.resolve({ ref: 's3/e2' }).kind,
      snapshots.resolve({ ref: 's3/e9' }),
      snapshots.resolve({ ref: 's9/e1' }),
      snapshots.resolve({ ref: 'e2' }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "kind": "refused",
          "reason": "Snapshot s1 is stale: a newer snapshot replaced it. Use the refs and coordinates from the latest get_window_state or get_desktop_state.",
        },
        {
          "kind": "refused",
          "reason": "Snapshot s1 is stale: a newer snapshot replaced it. Use the refs and coordinates from the latest get_window_state or get_desktop_state.",
        },
        "target",
        "target",
        {
          "kind": "refused",
          "reason": "Snapshot s3 has no element s3/e9.",
        },
        {
          "kind": "refused",
          "reason": "There is no snapshot s9. Call get_window_state or get_desktop_state first.",
        },
        {
          "kind": "refused",
          "reason": ""e2" is not an element ref; refs look like s3/e12.",
        },
      ]
    `);
  });

  it('keeps only the latest eight snapshots', () => {
    const snapshots = new Snapshots();
    for (let windowId = 1; windowId <= 9; windowId += 1) snapshots.addWindow(windowState(windowId, null));
    expect([snapshots.resolve({ ref: 's1/e2' }).kind, snapshots.resolve({ ref: 's2/e2' }).kind]).toMatchInlineSnapshot(`
      [
        "refused",
        "target",
      ]
    `);
  });

  it('refuses refs into a desktop snapshot and maps its points through the display', () => {
    const snapshots = new Snapshots();
    snapshots.addDesktop({
      display: { displayId: 1, frame: { x: 0, y: 0, width: 1512, height: 982 }, pixelWidth: 3024, pixelHeight: 1964, scale: 2, main: true },
      image: { base64: 'iVBORw0KGgo=', width: 1280, height: 831 },
    });
    expect([snapshots.resolve({ ref: 's1/e1' }), snapshots.resolve({ snapshot: 's1', x: 640, y: 415.5 })]).toMatchInlineSnapshot(`
      [
        {
          "kind": "refused",
          "reason": "s1 is a desktop snapshot, which has no element refs. Click by point instead.",
        },
        {
          "kind": "target",
          "target": {
            "check": {
              "displayId": 1,
              "frame": {
                "height": 982,
                "width": 1512,
                "x": 0,
                "y": 0,
              },
              "kind": "display",
            },
            "point": {
              "x": 756,
              "y": 491,
            },
          },
        },
      ]
    `);
  });
});
