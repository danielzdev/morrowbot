import { redact, type AppInfo } from '../../shared/privacy.ts';

const PLAIN = /^[\w@%+=:,./-]+$/;

const quote = (text: string): string => (PLAIN.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);

/**
 * A command as the user may copy it into a POSIX shell, or `guide` when it cannot be shown both
 * exactly and privately (spec §6.2 copy rule). An argument that is a path under home starts with an
 * unquoted `~/`, which the shell expands back; anything else that still names the home folder, an
 * email or the user name (such as `--config=/Users/sam/x`) would change if hidden, so it gets the guide.
 */
export function setupCommand(argv: readonly string[], info: AppInfo): { readonly kind: 'copy'; readonly text: string } | { readonly kind: 'guide' } {
  const home = info.homeDir;
  const words = argv.map((arg) => {
    if (home !== '' && arg === home) return '~';
    if (home !== '' && arg.startsWith(`${home}/`)) return `~/${quote(arg.slice(home.length + 1))}`;
    return quote(arg);
  });
  const text = words.join(' ');
  return redact(text, info) === text ? { kind: 'copy', text } : { kind: 'guide' };
}
