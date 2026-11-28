import { listDirectory, readOptionalFile, z, type CommandExit, type PluginRuntime, type RunCommandOptions } from '@morrowbot/plugin-sdk';
import { parseReply, type HelperReply, type HelperRequest } from './protocol.ts';

/** Runs one request in the native macOS helper. */
export interface Helper {
  run<S extends z.ZodType>(request: HelperRequest, value: S, signal: AbortSignal): Promise<HelperReply<z.output<S>>>;
}

const CALL_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 300_000;
const SOURCE_LIMIT = 256 * 1024;
const HELPER_SOURCE_DIR = decodeURIComponent(new URL('../helper/', import.meta.url).pathname);

export const unsupportedReason = 'Computer Use works only on macOS.';

/** The helper for this OS: the Swift helper on macOS, compiled once into `dataDir`; elsewhere every call is `unsupported`. */
export function createHelper(runtime: PluginRuntime, dataDir: string): Helper {
  if (runtime.platform === 'darwin') return swiftHelper(runtime, dataDir);
  return { run: () => Promise.resolve({ kind: 'unsupported', reason: unsupportedReason }) };
}

type Built = { readonly kind: 'built'; readonly path: string } | { readonly kind: 'failed'; readonly message: string };

function swiftHelper(runtime: PluginRuntime, dataDir: string): Helper {
  let building: Promise<Built> | null = null;
  const binary = async (): Promise<Built> => {
    building ??= build(runtime, dataDir);
    const built = await building;
    if (built.kind === 'failed') building = null;
    return built;
  };
  return {
    run: async (request, value, signal) => {
      const built = await binary();
      if (built.kind === 'failed') return { kind: 'failed', message: built.message };
      const lines: string[] = [];
      const exit = await runtime.runCommand(built.path, {
        args: [],
        cwd: dataDir,
        files: [],
        scope: { kind: 'probe' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
        input: JSON.stringify(request),
        onLine: (line) => lines.push(line),
      });
      if (signal.aborted) return { kind: 'failed', message: 'Stopped: the turn ended.' };
      const problem = exitProblem(exit, 'The helper');
      if (problem !== null) {
        if (exit.kind === 'not-found') building = null;
        return { kind: 'failed', message: problem };
      }
      return parseReply(lines, value);
    },
  };
}

function exitProblem(exit: CommandExit, what: string): string | null {
  switch (exit.kind) {
    case 'not-found':
      return `${what} was not found.`;
    case 'failed':
      return `${what} could not run: ${exit.message}`;
    case 'exited':
      if (exit.code === 0) return null;
      return `${what} stopped (${exit.signal ?? `exit ${String(exit.code)}`})${exit.stderr.trim() === '' ? '.' : `: ${exit.stderr.trim()}`}`;
  }
}

/** Compiles `helper/*.swift` into `dataDir`, named by a hash of the sources so an update rebuilds it. */
async function build(runtime: PluginRuntime, dataDir: string): Promise<Built> {
  const names = (await listDirectory(HELPER_SOURCE_DIR))?.filter((name) => name.endsWith('.swift')) ?? [];
  if (names.length === 0) return { kind: 'failed', message: `No helper sources in ${HELPER_SOURCE_DIR}.` };
  const sources = names.map((name) => `${HELPER_SOURCE_DIR}${name}`);
  const contents = await Promise.all(sources.map((file) => readOptionalFile(file, { maxBytes: SOURCE_LIMIT })));
  const key = await sha256(names.map((name, index) => `${name}\0${contents[index] ?? ''}`).join('\0'));
  const target = `${dataDir}/computer-use-helper-${key.slice(0, 16)}`;
  const existing = await runtime.statExecutable(target);
  if (existing.kind === 'found') return { kind: 'built', path: target };

  const partial = `${target}.partial`;
  const signal = AbortSignal.timeout(BUILD_TIMEOUT_MS);
  const quiet = (args: readonly string[]): RunCommandOptions => ({ args, cwd: dataDir, files: [], scope: { kind: 'probe' }, signal, input: '', onLine: () => undefined });
  const compiled = await runtime.runCommand('swiftc', quiet(['-O', '-swift-version', '5', '-module-cache-path', `${dataDir}/swift-module-cache`, '-o', partial, ...sources]));
  if (compiled.kind === 'not-found') {
    return { kind: 'failed', message: 'swiftc is not installed. Install the Xcode Command Line Tools (xcode-select --install), then try again.' };
  }
  const compileProblem = exitProblem(compiled, 'Building the Computer Use helper');
  if (compileProblem !== null) return { kind: 'failed', message: compileProblem };
  const moved = await runtime.runCommand('/bin/mv', quiet(['-f', partial, target]));
  const moveProblem = exitProblem(moved, 'Installing the Computer Use helper');
  if (moveProblem !== null) return { kind: 'failed', message: moveProblem };
  return { kind: 'built', path: target };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
