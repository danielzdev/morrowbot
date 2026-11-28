import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let reduceMotion = false;
const listeners = new Set<() => void>();

function learn(enabled: boolean): void {
  if (enabled === reduceMotion) return;
  reduceMotion = enabled;
  for (const listener of [...listeners]) listener();
}

void AccessibilityInfo.isReduceMotionEnabled().then(learn);
AccessibilityInfo.addEventListener('reduceMotionChanged', learn);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the user asked for less motion. The system is asked as the app loads and followed for its life, so a
 * view that mounts later already knows the answer and never starts moving first.
 */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduceMotion);
}
