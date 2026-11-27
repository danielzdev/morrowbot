import { expect, it } from 'vitest';
import { createEscapeStack, type Layer } from './escape-stack.ts';

function harness() {
  const log: string[] = [];
  const stack = createEscapeStack();
  const trigger = (name: string, connected = true) => ({ isConnected: connected, focus: () => log.push(`focus ${name}`) });
  const layer = (name: string, returnTo: string, inside: readonly string[] = [name]): Layer => ({
    close: () => log.push(`close ${name}`),
    returnFocus: trigger(returnTo),
    contains: (target) => typeof target === 'string' && inside.includes(target),
  });
  return { log, stack, layer, trigger };
}

it('closes only the topmost layer on each Esc and returns focus to that layer’s trigger', () => {
  const { log, stack, layer } = harness();
  stack.push(layer('modal', 'settings button'));
  stack.push(layer('popover', 'segment'));
  const taken = [stack.escape(), stack.escape(), stack.escape()];
  expect({ taken, log, depth: stack.depth }).toEqual({
    taken: [true, true, false],
    log: ['focus segment', 'close popover', 'focus settings button', 'close modal'],
    depth: 0,
  });
});

it('closes the top layer on an outside press, but not on a press inside it or its trigger', () => {
  const { log, stack, layer } = harness();
  stack.push(layer('modal', 'gear', ['modal', 'popover', 'menu']));
  stack.push(layer('menu', 'more button', ['menu', 'more button']));
  const presses = [stack.pointerDown('menu'), stack.pointerDown('more button'), stack.pointerDown('modal'), stack.pointerDown('modal')];
  expect({ presses, log, depth: stack.depth }).toEqual({
    presses: [false, false, true, false],
    log: ['focus more button', 'close menu'],
    depth: 1,
  });
});

it('removing a layer on unmount returns focus only if it was on top, and skips a trigger that is gone', () => {
  const { log, stack, layer, trigger } = harness();
  const removeModal = stack.push(layer('modal', 'gear'));
  const removePopover = stack.push({ ...layer('popover', 'row'), returnFocus: trigger('deleted row', false) });
  removeModal();
  removePopover();
  expect({ log, depth: stack.depth }).toEqual({ log: [], depth: 0 });
});
