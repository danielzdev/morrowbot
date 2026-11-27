import { describe, expect, it } from 'vitest';
import { foldedDuo, standardIPhone, unfoldedDuo, unfoldedDuoWithHinge } from './fixtures.test-support.ts';
import {
  deriveBottomControlInsets,
  deriveContentSideInsets,
  parseNativeLayoutMetrics,
  statusBlockBottom,
  type NativeLayoutMetrics,
} from './reserved-regions.ts';

describe('parseNativeLayoutMetrics', () => {
  it('accepts a native payload and turns a missing bottom bar inset into null', () => {
    const payload = Object.fromEntries(Object.entries(standardIPhone).filter(([key]) => key !== 'bottomBarInset'));
    expect(parseNativeLayoutMetrics(payload)).toEqual(standardIPhone);
  });

  it('rejects malformed payloads', () => {
    expect(parseNativeLayoutMetrics({ ...foldedDuo, verticalBarEdge: 'top' })).toBeNull();
    expect(parseNativeLayoutMetrics({ ...foldedDuo, width: Number.NaN })).toBeNull();
    expect(parseNativeLayoutMetrics(null)).toBeNull();
  });
});

describe('deriveContentSideInsets', () => {
  it('reports the safe area on devices with no division', () => {
    expect({
      none: deriveContentSideInsets(null),
      standardIPhone: deriveContentSideInsets(standardIPhone),
      foldedDuo: deriveContentSideInsets(foldedDuo),
      unfoldedDuo: deriveContentSideInsets(unfoldedDuo),
    }).toMatchInlineSnapshot(`
      {
        "foldedDuo": {
          "left": 0,
          "right": 76,
        },
        "none": {
          "left": 0,
          "right": 0,
        },
        "standardIPhone": {
          "left": 0,
          "right": 0,
        },
        "unfoldedDuo": {
          "left": 0,
          "right": 70,
        },
      }
    `);
  });

  it('keeps one column on the wider side of an active hinge', () => {
    expect(deriveContentSideInsets(unfoldedDuoWithHinge)).toMatchInlineSnapshot(`
      {
        "left": 0,
        "right": 515,
      }
    `);
  });

  it('ignores short divisions, which do not split the window', () => {
    const shortDivision: NativeLayoutMetrics = {
      ...unfoldedDuo,
      reservedRegions: [{ kind: 'division', x: 436, y: 0, width: 10, height: 200 }],
    };
    expect(deriveContentSideInsets(shortDivision)).toEqual(deriveContentSideInsets(unfoldedDuo));
  });
});

describe('deriveBottomControlInsets', () => {
  it('sits above the home indicator and inside the system bar', () => {
    expect({
      standardIPhone: deriveBottomControlInsets(standardIPhone),
      foldedDuo: deriveBottomControlInsets(foldedDuo),
      unfoldedDuoWithHinge: deriveBottomControlInsets(unfoldedDuoWithHinge),
    }).toMatchInlineSnapshot(`
      {
        "foldedDuo": {
          "bottom": 20,
          "left": 0,
          "right": 76,
        },
        "standardIPhone": {
          "bottom": 34,
          "left": 0,
          "right": 0,
        },
        "unfoldedDuoWithHinge": {
          "bottom": 20,
          "left": 0,
          "right": 515,
        },
      }
    `);
  });

  it('steps beside a narrow bottom occlusion and rises above a wide one', () => {
    const narrow: NativeLayoutMetrics = {
      ...standardIPhone,
      reservedRegions: [{ kind: 'occlusion', x: 0, y: 800, width: 80, height: 74 }],
    };
    const wide: NativeLayoutMetrics = {
      ...standardIPhone,
      reservedRegions: [{ kind: 'occlusion', x: 0, y: 780, width: 402, height: 94 }],
    };
    expect({
      narrow: deriveBottomControlInsets(narrow),
      wide: deriveBottomControlInsets(wide),
    }).toMatchInlineSnapshot(`
      {
        "narrow": {
          "bottom": 34,
          "left": 80,
          "right": 0,
        },
        "wide": {
          "bottom": 94,
          "left": 0,
          "right": 0,
        },
      }
    `);
  });
});

describe('statusBlockBottom', () => {
  it('finds the status block at the top of the vertical bar', () => {
    expect({
      foldedDuo: statusBlockBottom(foldedDuo, 'right'),
      oppositeEdge: statusBlockBottom(foldedDuo, 'left'),
      standardIPhone: statusBlockBottom(standardIPhone, 'right'),
    }).toMatchInlineSnapshot(`
      {
        "foldedDuo": 240,
        "oppositeEdge": 0,
        "standardIPhone": 62,
      }
    `);
  });
});
