import { expect, it } from 'vitest';
import { rovingTarget, typeAheadTarget } from './roving.ts';

it('moves with arrows, clamps at the ends, and jumps with Home/End', () => {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'];
  const from = (index: number) => Object.fromEntries(keys.map((key) => [key, rovingTarget(key, index, 4)]));
  expect({ none: from(-1), first: from(0), last: from(3), empty: rovingTarget('ArrowDown', -1, 0) }).toEqual({
    none: { ArrowDown: 0, ArrowUp: 3, Home: 0, End: 3, Enter: null },
    first: { ArrowDown: 1, ArrowUp: 0, Home: 0, End: 3, Enter: null },
    last: { ArrowDown: 3, ArrowUp: 2, Home: 0, End: 3, Enter: null },
    empty: null,
  });
});

it('finds the next label by prefix, after the current one and wrapping around', () => {
  const names = ['Errand Bot', 'Inbox Helper', 'Errand Runner', 'Reading Buddy'];
  expect({
    fromStart: typeAheadTarget(names, 'e', -1),
    next: typeAheadTarget(names, 'e', 0),
    wraps: typeAheadTarget(names, 'e', 2),
    longer: typeAheadTarget(names, 'errand r', -1),
    caseless: typeAheadTarget(names, 'READ', 0),
    missing: typeAheadTarget(names, 'z', 0),
  }).toEqual({ fromStart: 0, next: 2, wraps: 0, longer: 2, caseless: 3, missing: -1 });
});
