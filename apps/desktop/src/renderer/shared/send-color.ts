import { contrastRatio, normalizeHex } from './bubble-color.ts';

/**
 * The Send button in the agent's color, with whichever of black or white reads better on it; undefined
 * (the theme's plain button) when the setting is off or the color is not a hex color.
 */
export function sendButtonVars(agentColor: string, on: boolean): Readonly<Record<string, string>> | undefined {
  const hex = on ? normalizeHex(agentColor) : null;
  if (hex === null) return undefined;
  const fg = contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
  return { '--send-bg': hex, '--send-fg': fg };
}
