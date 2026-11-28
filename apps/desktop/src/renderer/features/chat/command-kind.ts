/** Words that start a command but say nothing about the work: the next word does. */
const PREFIXES = new Set(['sudo', 'env', 'time', 'nice', 'exec', 'command', 'npx', 'bunx', 'pnpx']);
/** Steps that only set the scene, such as `cd app &&`: the step after them names the work. */
const SETUP = new Set(['cd', 'pushd', 'export', 'source', '.', 'set', 'echo', 'true']);
const SHELLS = new Set(['bash', 'sh', 'zsh']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const TEST_RUNNERS = new Set(['vitest', 'jest', 'pytest', 'mocha', 'playwright']);
const CHECKERS = new Set(['eslint', 'tsc', 'prettier', 'ruff', 'mypy', 'biome', 'swiftlint']);
const BUILDERS = new Set(['make', 'xcodebuild', 'vite', 'webpack', 'rolldown', 'esbuild']);
const FILE_READERS = new Set(['ls', 'find', 'tree', 'cat', 'head', 'tail', 'less', 'wc', 'grep', 'rg', 'fd', 'stat', 'file', 'pwd']);
const FILE_CHANGERS = new Set(['mkdir', 'cp', 'mv', 'rm', 'touch', 'ln', 'chmod']);
const SCRIPT_RUNNERS = new Set(['node', 'python', 'python3', 'ruby', 'deno', 'tsx', 'perl']);
const INSTALL_WORDS = new Set(['install', 'i', 'ci', 'add', 'sync']);
const INSTALLERS = new Set(['pip', 'pip3', 'uv', 'poetry', 'brew', 'cargo', 'go', 'gem', 'apt', 'apt-get']);
const CHECK_SCRIPTS = /^(lint|typecheck|type-check|format|check|tsc)\b/u;
const MAX_DEPTH = 2;

/** What kind of work a shell command does ("Running tests", "Checking git"), in words that never show the command. */
export function commandDoing(command: string, depth = 0): string {
  for (const step of command.split(/&&|\|\||[;|\n]/u)) {
    const words = step.trim().split(/\s+/u).filter((word) => word !== '');
    while (words[0] !== undefined && (PREFIXES.has(words[0]) || /^[A-Z_][A-Z0-9_]*=/u.test(words[0]))) words.shift();
    const [first, ...rest] = words;
    if (first === undefined) continue;
    const program = first.split('/').at(-1) ?? first;
    if (SETUP.has(program)) continue;
    if (SHELLS.has(program) && /^-l?c$/u.test(rest[0] ?? '') && depth < MAX_DEPTH) return commandDoing(rest.slice(1).join(' ').replace(/^['"]|['"]$/gu, ''), depth + 1);
    return programDoing(program, rest);
  }
  return 'Running a command';
}

function programDoing(program: string, args: readonly string[]): string {
  const [sub = '', next = ''] = args;
  if (TEST_RUNNERS.has(program) || (sub === 'test' && program !== 'git')) return 'Running tests';
  if (PACKAGE_MANAGERS.has(program)) {
    if (INSTALL_WORDS.has(sub)) return 'Installing packages';
    const script = sub === 'run' ? next : sub;
    if (script.startsWith('test')) return 'Running tests';
    if (script.startsWith('build')) return 'Building';
    if (CHECK_SCRIPTS.test(script)) return 'Checking the code';
    return 'Running a script';
  }
  if (INSTALLERS.has(program) && INSTALL_WORDS.has(sub)) return 'Installing packages';
  if (CHECKERS.has(program)) return 'Checking the code';
  if (BUILDERS.has(program) || sub === 'build') return 'Building';
  if (program === 'git') return sub === 'commit' ? 'Committing changes' : sub === 'push' ? 'Pushing changes' : 'Checking git';
  if (program === 'gh') return 'Checking GitHub';
  if (FILE_READERS.has(program)) return 'Looking through files';
  if (FILE_CHANGERS.has(program)) return 'Changing files';
  if (program === 'curl' || program === 'wget') return 'Fetching from the web';
  if (SCRIPT_RUNNERS.has(program)) return 'Running a script';
  return 'Running a command';
}
