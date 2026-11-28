import * as SecureStore from 'expo-secure-store';
import { useEffect, useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';
import { z } from 'zod';

export const AppearanceChoice = z.enum(['system', 'light', 'dark']);
export type AppearanceChoice = z.infer<typeof AppearanceChoice>;

const KEY = 'morrowbot.appearance';
let choice: AppearanceChoice = 'system';
const listeners = new Set<() => void>();

function apply(next: AppearanceChoice): void {
  choice = next;
  Appearance.setColorScheme(next === 'system' ? 'auto' : next);
  for (const listener of listeners) listener();
}

/** Saves and applies the choice for the whole app; `system` follows iOS. */
export function chooseAppearance(next: AppearanceChoice): void {
  apply(next);
  void SecureStore.setItemAsync(KEY, next).catch((error: unknown) => {
    console.warn('Ori Kami settings: could not save appearance', error);
  });
}

export function useAppearanceChoice(): AppearanceChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => choice,
  );
}

/** Applies the saved appearance once at launch. */
export function SavedAppearance() {
  useEffect(() => {
    void SecureStore.getItemAsync(KEY).then((saved) => {
      const parsed = AppearanceChoice.safeParse(saved);
      if (parsed.success) apply(parsed.data);
    });
  }, []);
  return null;
}
