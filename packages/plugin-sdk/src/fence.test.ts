import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCommandRunner, type RunCommandOptions } from './command.ts';
import { dataFolderFence, type FencedFolders } from './fence.ts';
import { createGroupLink } from './host-link.ts';

it('hides the named entries, keeps the data folder read-only but for its writable folders, and pins it in a Seatbelt profile, on macOS only', () => {
  const folders: FencedFolders = {
    data: '/Users/someone/My "Data"/',
    hidden: ['vault', 'server.json'],
    writable: ['/Users/someone/My "Data"/workspaces'],
    readOnly: ['/Users/someone/plugins'],
  };
  expect({ mac: dataFolderFence('darwin', folders), linux: dataFolderFence('linux', folders) }).toMatchInlineSnapshot(`
    {
      "linux": {
        "kind": "open",
      },
      "mac": {
        "kind": "seatbelt",
        "profile": "(version 1)
    (allow default)
    (deny file-write* (subpath "/Users/someone/My \\"Data\\"") (subpath "/Users/someone/plugins") (literal "/Users/someone") (literal "/Users") (literal "/"))
    (allow file-write* (subpath "/Users/someone/My \\"Data\\"/workspaces"))
    (deny file-clone (literal "/Users/someone/My \\"Data\\"") (literal "/Users/someone") (literal "/Users") (literal "/"))
    (deny file-read* file-write* (prefix "/Users/someone/My \\"Data\\"/vault") (prefix "/Users/someone/My \\"Data\\"/server.json"))
    (deny lsopen)
    (deny appleevent-send)
    (allow process-exec (literal "/bin/ps") (literal "/usr/bin/top") (with no-sandbox))",
      },
    }
  `);
});

it('refuses a fence that hides nothing, a relative folder, or a writable folder outside the data folder', () => {
  const folders: FencedFolders = { data: '/data', hidden: ['vault'], writable: [], readOnly: [] };
  const attempt = (changed: Partial<FencedFolders>): string => {
    try {
      dataFolderFence('darwin', { ...folders, ...changed });
      return 'made';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  expect([attempt({ hidden: [] }), attempt({ data: 'data' }), attempt({ writable: ['/data'] }), attempt({ writable: ['/elsewhere'] })]).toEqual([
    'A fence must hide at least one entry',
    'A fenced folder must be an absolute path: data',
    'A writable folder must be inside the data folder: /data',
    'A writable folder must be inside the data folder: /elsewhere',
  ]);
});

/**
 * Each attempt prints `<attempt>: ok` or `<attempt>: denied`. `$F` is the data folder, `$R` the folder above it.
 * `read_clone` copies a whole folder in one `clonefileat(2)` call (syscall 462), which `cp -c` never makes for a folder.
 */
const ATTEMPTS = String.raw`
GUARD=$PPID
read_clone() { /usr/bin/perl -e 'exit(syscall(462, -2, $ARGV[0], -2, $ARGV[1], 0) == 0 ? 0 : 1)' "$1" "$2" && cat "$2/$3"; }
try() { name=$1; shift; if "$@" >/dev/null 2>&1; then echo "$name: ok"; else echo "$name: denied"; fi; }
try 'read vault-secrets.json' cat "$F/vault-secrets.json"
try 'read vault.key' cat "$F/vault.key"
try 'read orikami.sqlite' cat "$F/orikami.sqlite"
try 'read server.json' cat "$F/server.json"
try 'read it in other letter case' cat "$F/VAULT-SECRETS.JSON"
try 'copy it' cp "$F/vault-secrets.json" "$R/copy"
try 'hard-link it' ln "$F/vault-secrets.json" "$R/hard"
try 'read it through a symlink' sh -c 'ln -s "$1/vault-secrets.json" "$2/soft" && cat "$2/soft"' _ "$F" "$R"
try 'read it in a clone of the folder' read_clone "$F" "$R/clone" vault-secrets.json
try 'read it in a clone of the folder above it' read_clone "$R" "$R-clone" 'data "dir"/vault-secrets.json'
try 'rename it' mv "$F/vault-secrets.json" "$F/renamed"
try 'create vault.json' sh -c 'echo {} > "$1/vault.json"' _ "$F"
try 'move the folder' mv "$F" "$R/moved"
try 'move the folder above it' mv "$R" "$R-moved"
try 'write a new file in the data folder' sh -c 'echo hi > "$1/new.txt"' _ "$F"
try 'write in the plugins folder' sh -c 'echo hi > "$1/plugins/new.js"' _ "$R"
try 'move the plugins folder' mv "$R/plugins" "$R/plugins-moved"
try 'write in a workspace' sh -c 'echo hi > "$1/workspaces/note.txt" && cat "$1/workspaces/note.txt"' _ "$F"
try 'read notes.txt' cat "$F/notes.txt"
try 'open an app, which macOS would start outside the fence' open -g -j "$R/Probe.app"
try 'debug the program that started it' sh -c 'kill -USR1 "$1" && sleep 1 && curl -sf http://127.0.0.1:9229/json/list' _ "$GUARD"
try 'list processes' /bin/ps -p $$
try 'sudo' /usr/bin/sudo -n true
`;

const PROBE_PLIST =
  '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>probe</string><key>CFBundleIdentifier</key><string>com.legendarykoi.orikami.fence-probe</string></dict></plist>';

describe.runIf(process.platform === 'darwin')('a fenced command on this Mac', () => {
  let root = '';
  let folder = '';
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-fence-')));
    folder = path.join(root, 'data "dir"');
    await mkdir(path.join(folder, 'workspaces'), { recursive: true });
    await mkdir(path.join(root, 'plugins'));
    for (const name of ['vault-secrets.json', 'vault.key', 'orikami.sqlite', 'server.json', 'notes.txt']) await writeFile(path.join(folder, name), `${name} contents\n`);
    await writeFile(path.join(root, 'not-executable'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    const app = path.join(root, 'Probe.app', 'Contents');
    await mkdir(path.join(app, 'MacOS'), { recursive: true });
    await writeFile(path.join(app, 'MacOS', 'probe'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await writeFile(path.join(app, 'Info.plist'), PROBE_PLIST);
  });
  afterEach(async () => {
    for (const each of [root, `${root}-clone`, `${root}-moved`]) await rm(each, { recursive: true, force: true });
  });

  const fence = () =>
    dataFolderFence('darwin', { data: folder, hidden: ['vault', 'orikami.sqlite', 'server.json'], writable: [path.join(folder, 'workspaces')], readOnly: [path.join(root, 'plugins')] });

  const options = (args: readonly string[], lines: string[]): RunCommandOptions => ({
    args,
    cwd: root,
    files: [],
    env: { F: folder, R: root },
    scope: { kind: 'probe' },
    signal: new AbortController().signal,
    input: '',
    onLine: (line) => lines.push(line),
  });

  it('keeps it and every program it starts from the hidden files, from writing outside its workspaces and from moving a fenced folder, and leaves the rest usable', async () => {
    const commands = createCommandRunner(createGroupLink(), { PATH: process.env.PATH }, fence());
    const lines: string[] = [];
    const exit = await commands.run('sh', options(['-c', ATTEMPTS], lines));
    expect({ exit: exit.kind, lines }).toEqual({
      exit: 'exited',
      lines: [
        'read vault-secrets.json: denied',
        'read vault.key: denied',
        'read orikami.sqlite: denied',
        'read server.json: denied',
        'read it in other letter case: denied',
        'copy it: denied',
        'hard-link it: denied',
        'read it through a symlink: denied',
        'read it in a clone of the folder: denied',
        'read it in a clone of the folder above it: denied',
        'rename it: denied',
        'create vault.json: denied',
        'move the folder: denied',
        'move the folder above it: denied',
        'write a new file in the data folder: denied',
        'write in the plugins folder: denied',
        'move the plugins folder: denied',
        'write in a workspace: ok',
        'read notes.txt: ok',
        'open an app, which macOS would start outside the fence: denied',
        'debug the program that started it: denied',
        'list processes: ok',
        'sudo: denied',
      ],
    });
  });

  it('finds programs without a PATH, and says which command is missing or not executable', async () => {
    const commands = createCommandRunner(createGroupLink(), {}, fence());
    const lines: string[] = [];
    const found = await commands.run('sh', options(['-c', 'echo found'], lines));
    const missing = await commands.run('no-such-command-anywhere', options([], []));
    const notExecutable = await commands.run(path.join(root, 'not-executable'), options([], []));
    expect({ found: found.kind, lines, missing, notExecutable }).toEqual({
      found: 'exited',
      lines: ['found'],
      missing: { kind: 'not-found' },
      notExecutable: { kind: 'failed', message: `${path.join(root, 'not-executable')} is not executable` },
    });
  });
});
