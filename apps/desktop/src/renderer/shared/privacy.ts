import { z } from 'zod';

/** What desktop main reports about this machine (H6). Only this module and About read it, and never show it raw. */
export const AppInfo = z.strictObject({
  appVersion: z.string(),
  homeDir: z.string(),
  userName: z.string(),
  dataDir: z.string(),
});
export type AppInfo = z.infer<typeof AppInfo>;

const escape = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const SEPARATOR = /[\\/]/;

/**
 * Makes host or provider text safe to show (spec §9.1): the home path becomes `~`, emails become
 * `<email>`, and the OS user name, as a whole word or path segment, becomes `<user>`.
 */
export function redact(text: string, info: AppInfo): string {
  let safe = text;
  if (info.homeDir !== '') safe = safe.replace(new RegExp(`${escape(info.homeDir)}(?=[\\\\/]|$|[^\\w.-])`, 'g'), '~');
  safe = safe.replace(EMAIL, '<email>');
  if (info.userName !== '') safe = safe.replace(new RegExp(`(?<!\\w)${escape(info.userName)}(?!\\w)`, 'g'), '<user>');
  return safe;
}

function homeRelative(path: string, homeDir: string): string {
  if (homeDir === '' || !path.startsWith(homeDir)) return path;
  const rest = path.slice(homeDir.length);
  return rest === '' || SEPARATOR.test(rest.charAt(0)) ? `~${rest}` : path;
}

const isWithin = (path: string, root: string): boolean => root !== '' && (path === root || (path.startsWith(root) && SEPARATOR.test(path.charAt(root.length))));

/**
 * A path as the UI may show it (spec §9.1): under home, MorrowBot's own folders and the agent's
 * workspace in full as `~/…`; any other path as its last two segments. Then `redact` applies.
 */
export function displayPath(path: string, info: AppInfo, workspaceDir: string | null = null): string {
  const shown = homeRelative(path, info.homeDir);
  const own = shown.startsWith('~') && [info.dataDir, `${info.homeDir}/.morrowbot`, workspaceDir ?? ''].some((root) => isWithin(path, root));
  if (own) return redact(shown, info);
  const segments = shown.split(SEPARATOR).filter((segment) => segment !== '' && segment !== '~');
  return redact(segments.length <= 2 ? shown : `…/${segments.slice(-2).join('/')}`, info);
}

const PLAN_LABELS = [
  'Claude Pro',
  'Claude Max 5x',
  'Claude Max 20x',
  'ChatGPT',
  'ChatGPT Free',
  'ChatGPT Go',
  'ChatGPT Plus',
  'ChatGPT Pro',
  'ChatGPT Business',
  'ChatGPT Enterprise',
  'ChatGPT Edu',
  'OpenAI API key',
];

/** The allowlisted plan label in a provider's account text, never a name, email or workspace; null when none matches. */
export function planLabel(accountLabel: string): string | null {
  const matches = PLAN_LABELS.filter((label) => accountLabel === label || accountLabel.startsWith(`${label} (`));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}
