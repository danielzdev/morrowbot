import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCommandRunner, type RunCommandOptions } from './command.ts';
import { hiddenFilesFence } from './fence.ts';
import { createGroupLink } from './host-link.ts';

it('hides the named entries and pins the folder and every parent in a Seatbelt profile, on macOS only', () => {
  expect({
    mac: hiddenFilesFence('darwin', '/Users/someone/My "Data"', ['vault', 'morrowbot.sqlite']),
    linux: hiddenFilesFence('linux', '/home/someone/data', ['vault']),
  }).toMatchInlineSnapshot(`
    {
      "linux": {
        "kind": "open",
      },
      "mac": {
        "kind": "seatbelt",
        "profile": "(version 1)
    (allow default)
    (deny file-read* file-write* (prefix "/Users/someone/My \\"Data\\"/vault") (prefix "/Users/someone/My \\"Data\\"/morrowbot.sqlite"))
    (deny file-write* (literal "/Users/someone/My \\"Data\\"") (literal "/Users/someone") (literal "/Users") (literal "/"))
    (deny lsopen)
    (deny appleevent-send)
    (allow process-exec (literal "/bin/ps") (literal "/usr/bin/top") (with no-sandbox))",
      },
    }
  `);
});

/** Each attempt prints `<attempt>: ok` or `<attempt>: denied`. `$F` is the fenced folder, `$R` the folder above it. */
const ATTEMPTS = String.raw`
try() { name=$1; shift; if "$@" >/dev/null 2>&1; then echo "$name: ok"; else echo "$name: denied"; fi; }
try 'read vault-secrets.json' cat "$F/vault-secrets.json"
try 'read vault.key' cat "$F/vault.key"
try 'read morrowbot.sqlite' cat "$F/morrowbot.sqlite"
try 'read it in other letter case' cat "$F/VAULT-SECRETS.JSON"
try 'copy it' cp "$F/vault-secrets.json" "$R/copy"
try 'hard-link it' ln "$F/vault-secrets.json" "$R/hard"
try 'read it through a symlink' sh -c 'ln -s "$1/vault-secrets.json" "$2/soft" && cat "$2/soft"' _ "$F" "$R"
try 'rename it' mv "$F/vault-secrets.json" "$F/renamed"
try 'create vault.json' sh -c 'echo {} > "$1/vault.json"' _ "$F"
try 'move the folder' mv "$F" "$R/moved"
try 'move the folder above it' mv "$R" "$R-moved"
try 'open an app, which macOS would start outside the fence' open -g -j "$R/Probe.app"
try 'read notes.txt' cat "$F/notes.txt"
try 'write a new file in the folder' sh -c 'echo hi > "$1/new.txt"' _ "$F"
try 'list processes' /bin/ps -p $$
try 'sudo' /usr/bin/sudo -n true
`;

const PROBE_PLIST =
  '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>probe</string><key>CFBundleIdentifier</key><string>com.legendarykoi.morrowbot.fence-probe</string></dict></plist>';

describe.runIf(process.platform === 'darwin')('a fenced command on this Mac', () => {
  let root = '';
  let folder = '';
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-fence-')));
    folder = path.join(root, 'data "dir"');
    await mkdir(folder);
    for (const name of ['vault-secrets.json', 'vault.key', 'morrowbot.sqlite', 'notes.txt']) await writeFile(path.join(folder, name), `${name} contents\n`);
    const app = path.join(root, 'Probe.app', 'Contents');
    await mkdir(path.join(app, 'MacOS'), { recursive: true });
    await writeFile(path.join(app, 'MacOS', 'probe'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    await writeFile(path.join(app, 'Info.plist'), PROBE_PLIST);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

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

  it('keeps it and every program it starts from the hidden files and from moving the folder, and leaves the rest usable', async () => {
    const commands = createCommandRunner(createGroupLink(), { PATH: process.env.PATH }, hiddenFilesFence('darwin', folder, ['vault', 'morrowbot.sqlite']));
    const lines: string[] = [];
    const exit = await commands.run('sh', options(['-c', ATTEMPTS], lines));
    const missing = await commands.run('no-such-command-anywhere', options([], []));
    expect({ exit: exit.kind, lines, missing }).toEqual({
      exit: 'exited',
      lines: [
        'read vault-secrets.json: denied',
        'read vault.key: denied',
        'read morrowbot.sqlite: denied',
        'read it in other letter case: denied',
        'copy it: denied',
        'hard-link it: denied',
        'read it through a symlink: denied',
        'rename it: denied',
        'create vault.json: denied',
        'move the folder: denied',
        'move the folder above it: denied',
        'open an app, which macOS would start outside the fence: denied',
        'read notes.txt: ok',
        'write a new file in the folder: ok',
        'list processes: ok',
        'sudo: denied',
      ],
      missing: { kind: 'not-found' },
    });
  });
});
