import { displayPath, redact, type AppInfo } from '../../shared/privacy.ts';
import type { ToolDisplay } from './tool-rows.ts';

/** How the chat makes host and provider text safe to show (spec §9.1). */
export interface ChatDisplay extends ToolDisplay {
  /** Host text made safe, or null while this window does not yet know the machine's home and user name. */
  readonly safe: (text: string) => string | null;
}

/** Shown in place of a value until this window knows the machine's home and user name (§9.1: left out). */
const WITHHELD = '…';

/**
 * Paths inside the agent's workspace show relative to it ("notes/plan.md"); other paths follow
 * `displayPath`. Tool input arrives with home already shown as `~`.
 */
export function chatDisplay(info: AppInfo | null, workspaceDir: string | null): ChatDisplay {
  if (info === null) return { safe: () => null, redact: () => WITHHELD, path: () => WITHHELD };
  const known = info;
  return {
    safe: (text) => redact(text, known),
    redact: (text) => redact(text, known),
    path: (path) => {
      const absolute = known.homeDir !== '' && (path === '~' || path.startsWith('~/')) ? `${known.homeDir}${path.slice(1)}` : path;
      if (workspaceDir !== null && workspaceDir !== '' && absolute.startsWith(`${workspaceDir}/`)) return redact(absolute.slice(workspaceDir.length + 1), known);
      return displayPath(absolute, known, workspaceDir);
    },
  };
}
