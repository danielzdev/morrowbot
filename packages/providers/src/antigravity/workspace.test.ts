import { standaloneRuntime } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { checkWorkspace } from './workspace.ts';

const { runCommand } = standaloneRuntime();

/** Runs a shell script with `params` as $1, $2, …: plugin tests reach the file system only through commands. */
async function sh(script: string, ...params: string[]): Promise<string> {
  let output = '';
  const exit = await runCommand('/bin/sh', {
    args: ['-c', script, 'sh', ...params],
    cwd: '/',
    input: '',
    files: [],
    scope: { kind: 'probe' },
    signal: AbortSignal.timeout(10_000),
    onLine: (line) => {
      output += `${line}\n`;
    },
  });
  if (exit.kind !== 'exited' || exit.code !== 0) throw new Error(`sh failed: ${JSON.stringify(exit)}`);
  return output.trim();
}

it('finds a customization folder in a git root whose name ends in a newline, and through a symlinked workspace', async () => {
  const root = await sh('cd "$(mktemp -d)" && pwd -P');
  await sh(
    `cd "$1" && mkdir -p 'repo
/.git' 'repo
/.agents' 'repo
/ws' repo/ws plain/ws real/.git real/_agent real/ws && ln -s "$1/real/ws" linked`,
    root,
  );
  const check = async (folder: string): Promise<unknown> => {
    const found = await checkWorkspace(runCommand, `${root}/${folder}`, AbortSignal.timeout(10_000));
    return found.kind === 'customized' ? { kind: found.kind, folder: found.folder.replace(root, '<root>') } : found;
  };
  const results = { newline: await check('repo\n/ws'), lookalike: await check('repo/ws'), plain: await check('plain/ws'), linked: await check('linked'), missing: await check('missing') };
  await sh('rm -rf "$1"', root);
  expect(results).toMatchInlineSnapshot(`
    {
      "linked": {
        "folder": "<root>/real/_agent",
        "kind": "customized",
      },
      "lookalike": {
        "kind": "clear",
      },
      "missing": {
        "kind": "unknown",
        "reason": "MorrowBot could not check the workspace for Antigravity customizations.",
      },
      "newline": {
        "folder": "<root>/repo",
        "kind": "customized",
      },
      "plain": {
        "kind": "clear",
      },
    }
  `);
});
