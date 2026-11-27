import { expect, it } from 'vitest';
import { placeFloating } from './place.ts';

const VIEW = { width: 1000, height: 700 };
const MENU = { width: 200, height: 160 };
const at = (top: number, left: number) => ({ top, left, width: 28, height: 28 });

it('sits 8px from its trigger, flips when there is no room, and keeps a 16px gutter', () => {
  expect({
    below: placeFloating(at(100, 300), MENU, VIEW, 'bottom', 'start'),
    flipsUp: placeFloating(at(600, 300), MENU, VIEW, 'bottom', 'start'),
    flipsDown: placeFloating(at(40, 300), MENU, VIEW, 'top', 'start'),
    endAligned: placeFloating(at(100, 300), MENU, VIEW, 'bottom', 'end'),
    clampedRight: placeFloating(at(100, 960), MENU, VIEW, 'bottom', 'start'),
    clampedLeft: placeFloating(at(100, 4), MENU, VIEW, 'bottom', 'end'),
    right: placeFloating(at(300, 20), MENU, VIEW, 'right', 'center'),
    rightFlips: placeFloating(at(300, 900), MENU, VIEW, 'right', 'center'),
    tooTall: placeFloating(at(300, 300), { width: 200, height: 900 }, VIEW, 'bottom', 'start'),
  }).toEqual({
    below: { side: 'bottom', top: 136, left: 300 },
    flipsUp: { side: 'top', top: 432, left: 300 },
    flipsDown: { side: 'bottom', top: 76, left: 300 },
    endAligned: { side: 'bottom', top: 136, left: 128 },
    clampedRight: { side: 'bottom', top: 136, left: 784 },
    clampedLeft: { side: 'bottom', top: 136, left: 16 },
    right: { side: 'right', top: 234, left: 56 },
    rightFlips: { side: 'bottom', top: 336, left: 784 },
    tooTall: { side: 'bottom', top: 16, left: 300 },
  });
});
