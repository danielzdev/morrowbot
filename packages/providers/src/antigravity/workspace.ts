import type { PluginRuntime } from '@morrowbot/plugin-sdk';

const PROBE_MS = 10_000;

/**
 * Prints the first customization folder agy would load for a session in `$1`, if any: one of
 * `.agents`, `.agent`, `_agents`, `_agent`, in the folder or any folder above it up to its git root.
 * agy runs the hooks, plugins and MCP servers in them without asking, even with its own
 * `--gemini-dir` (checked on agy 1.5.18).
 */
const FIND_CUSTOMIZATIONS = `
start=$1
root=$start
dir=$start
while :; do
  if [ -e "$dir/.git" ]; then root=$dir; break; fi
  parent=$(dirname "$dir")
  if [ "$parent" = "$dir" ]; then break; fi
  dir=$parent
done
dir=$start
while :; do
  for name in .agents .agent _agents _agent; do
    if [ -e "$dir/$name" ] || [ -L "$dir/$name" ]; then printf '%s\\n' "$dir/$name"; exit 0; fi
  done
  if [ "$dir" = "$root" ]; then exit 0; fi
  dir=$(dirname "$dir")
done
`;

export type WorkspaceCheck = { readonly kind: 'clear' } | { readonly kind: 'customized'; readonly folder: string } | { readonly kind: 'unknown'; readonly reason: string };

/** Whether agy would load customizations that run code for a session in `cwd`. */
export async function checkWorkspace(runCommand: PluginRuntime['runCommand'], cwd: string, signal: AbortSignal): Promise<WorkspaceCheck> {
  let found = '';
  const exit = await runCommand('/bin/sh', {
    args: ['-c', FIND_CUSTOMIZATIONS, 'sh', cwd],
    cwd: '/',
    input: '',
    files: [],
    scope: { kind: 'probe' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_MS)]),
    onLine: (line) => {
      if (found === '') found = line;
    },
  });
  if (exit.kind !== 'exited' || exit.code !== 0) return { kind: 'unknown', reason: 'MorrowBot could not check the workspace for Antigravity customizations.' };
  return found === '' ? { kind: 'clear' } : { kind: 'customized', folder: found };
}
