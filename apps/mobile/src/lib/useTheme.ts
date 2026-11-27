import { useColorScheme } from 'react-native';
import { themeFor, type Theme } from './theme.ts';

/** The theme for the current system appearance. */
export function useTheme(): Theme {
  return themeFor(useColorScheme());
}
