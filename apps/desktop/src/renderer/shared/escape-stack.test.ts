import { expect, it } from 'vitest';
import { createEscapeStack, type Layer } from './escape-stack.ts';

function harness() {
  const log: string[] = [];
  const stack = createEscapeStack();
  const trigger = (name: string, connected = true) => ({ isConnected: connected, focus: () => log.push(`focus ${name}`) });
  const removers = new Map<string, () => void>();
  /** A layer that unmounts when asked to close, as Popover and Modal do. */
  const layer = (name: string, returnTo: string, inside: readonly string[] = [name]): Layer => ({
    close: () => {
      log.push(`close ${name}`);
      removers.get(name)?.();
    },
    returnFocus: trigger(returnTo),
    contains: (target) => typeof target === 'string' && inside.includes(target),
  });
  const open = (name: string, returnTo: string, inside?: readonly string[]): (() => void) => {
    const remove = stack.push(layer(name, returnTo, inside));
    removers.set(name, remove);
    return remove;
  };
  return { log, stack, layer, open, trigger };
}

it('closes only the topmost layer on each Esc and returns focus to that layer’s trigger', () => {
  const { log, stack, open } = harness();
  open('modal', 'settings button');
  open('popover', 'segment');
  const taken = [stack.escape(), stack.escape(), stack.escape()];
  expect({ taken, log, depth: stack.depth }).toEqual({
    taken: [true, true, false],
    log: ['close popover', 'focus segment', 'close modal', 'focus settings button'],
    depth: 0,
  });
});

it('closes the top layer on an outside press, but not on a press inside it or its trigger', () => {
  const { log, stack, open } = harness();
  open('modal', 'gear', ['modal', 'popover', 'menu']);
  open('menu', 'more button', ['menu', 'more button']);
  const presses = [stack.pointerDown('menu'), stack.pointerDown('more button'), stack.pointerDown('modal'), stack.pointerDown('modal')];
  expect({ presses, log, depth: stack.depth }).toEqual({
    presses: [false, false, true, false],
    log: ['close menu', 'focus more button'],
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

it('keeps a layer that declines to close, so Esc still reaches it after its own confirm is cancelled', () => {
  const { log, stack, layer, open } = harness();
  stack.push({
    ...layer('form', 'new agent button'),
    close: () => {
      log.push('form asks first');
      open('discard confirm', 'form');
    },
  });
  stack.escape();
  stack.escape();
  const afterCancel = stack.depth;
  stack.escape();
  expect({ log, afterCancel, depth: stack.depth }).toEqual({
    log: ['form asks first', 'close discard confirm', 'focus form', 'form asks first'],
    afterCancel: 1,
    depth: 2,
  });
});
