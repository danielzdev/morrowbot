import { expect, it } from 'vitest';
import { createFence } from './fence.ts';

it('notifies active subscribers once on trip, drops unsubscribed listeners, and notifies late subscribers immediately', () => {
  const fence = createFence();
  const heard: string[] = [];
  const stopFirst = fence.subscribe((reason) => heard.push(`first:${reason}`));
  const stopSecond = fence.subscribe((reason) => heard.push(`second:${reason}`));
  stopFirst();
  stopFirst();

  expect(fence.reason()).toBeNull();
  fence.trip('mode drifted');
  fence.trip('ignored second trip');
  expect(fence.reason()).toBe('mode drifted');

  const stopLate = fence.subscribe((reason) => heard.push(`late:${reason}`));
  stopLate();
  stopSecond();

  expect(heard).toEqual(['second:mode drifted', 'late:mode drifted']);
});
