import { runCommand } from '@morrowbot/plugin-sdk';
import { expect, it } from 'vitest';
import { checkManagedPolicy, type Policy } from './policy.ts';

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

/** A file to create under the temporary root: contents, or `dir` for an empty folder, or `locked` contents (chmod 000). */
type Entry = string | { readonly kind: 'dir' } | { readonly kind: 'locked'; readonly contents: string };

interface Machine {
  readonly files?: Readonly<Record<string, Entry>>;
  readonly platform?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** Builds `files` under a fresh temporary root (HOME is `/home/tester` under it; `<root>` in `env` names it) and checks the policy there. */
async function policyOn({ files = {}, platform = 'linux', env = {} }: Machine): Promise<Policy> {
  const root = await sh('mktemp -d "${TMPDIR:-/tmp}/claude-policy-XXXXXX"');
  try {
    for (const [file, entry] of Object.entries(files)) {
      const target = `${root}${file}`;
      if (typeof entry === 'string') {
        await sh('mkdir -p "$(dirname "$1")" && printf "%s" "$2" > "$1"', target, entry);
        continue;
      }
      switch (entry.kind) {
        case 'dir':
          await sh('mkdir -p "$1"', target);
          break;
        case 'locked':
          await sh('mkdir -p "$(dirname "$1")" && printf "%s" "$2" > "$1" && chmod 000 "$1"', target, entry.contents);
          break;
      }
    }
    const home = `${root}/home/tester`;
    const rooted = Object.fromEntries(Object.entries(env).map(([name, value]) => [name, value.replaceAll('<root>', root)]));
    const policy = await checkManagedPolicy({ root, platform, env: { HOME: home, USER: 'tester', ...rooted } });
    return policy.kind === 'clear' ? policy : { kind: 'withheld', reason: policy.reason.replaceAll(root, '<root>') };
  } finally {
    await sh('chmod -R u+rwx "$1" && rm -rf "$1"', root);
  }
}

const MANAGED = '/etc/claude-code';
const HOME_CLAUDE = '/home/tester/.claude';
const hooks = JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'curl evil' }] }] } });

it('advertises when no managed source exists, or each is empty', async () => {
  expect({
    nothing: await policyOn({}),
    emptyManagedFolder: await policyOn({ files: { [MANAGED]: { kind: 'dir' } } }),
    emptyRemoteFile: await policyOn({ files: { [`${HOME_CLAUDE}/remote-settings.json`]: ' \n' } }),
    emptyRemoteObject: await policyOn({ files: { [`${HOME_CLAUDE}/remote-settings.json`]: '{}' } }),
  }).toMatchInlineSnapshot(`
    {
      "emptyManagedFolder": {
        "kind": "clear",
      },
      "emptyRemoteFile": {
        "kind": "clear",
      },
      "emptyRemoteObject": {
        "kind": "clear",
      },
      "nothing": {
        "kind": "clear",
      },
    }
  `);
});

it('withholds for anything in the system managed folder', async () => {
  const reason = async (file: string, contents: string) =>
    policyOn({ files: { [`${MANAGED}/${file}`]: contents } }).then((policy) => (policy.kind === 'withheld' ? policy.reason : 'clear'));
  expect({
    hooks: await reason('managed-settings.json', hooks),
    mcpServer: await reason('managed-settings.json', JSON.stringify({ mcpServers: { x: { command: 'x' } } })),
    extraDir: await reason('managed-settings.json', JSON.stringify({ permissions: { additionalDirectories: ['/'] } })),
    helper: await reason('managed-settings.json', JSON.stringify({ apiKeyHelper: '/bin/echo key' })),
    emptyMcpMap: await reason('managed-mcp.json', '{"mcpServers":{}}'),
    dropIn: await reason('managed-settings.d/10-team.json', '{}'),
    futureFile: await reason('policy-from-a-later-version.json', ''),
  }).toMatchInlineSnapshot(`
    {
      "dropIn": "Claude Code managed settings are installed in /etc/claude-code (managed-settings.d).",
      "emptyMcpMap": "Claude Code managed settings are installed in /etc/claude-code (managed-mcp.json).",
      "extraDir": "Claude Code managed settings are installed in /etc/claude-code (managed-settings.json).",
      "futureFile": "Claude Code managed settings are installed in /etc/claude-code (policy-from-a-later-version.json).",
      "helper": "Claude Code managed settings are installed in /etc/claude-code (managed-settings.json).",
      "hooks": "Claude Code managed settings are installed in /etc/claude-code (managed-settings.json).",
      "mcpServer": "Claude Code managed settings are installed in /etc/claude-code (managed-settings.json).",
    }
  `);
});

it('withholds for cached server-managed settings in the config folder that applies', async () => {
  expect({
    remote: await policyOn({ files: { [`${HOME_CLAUDE}/remote-settings.json`]: '{"permissions":{"allow":["Bash"]}}' } }),
    hybrid: await policyOn({
      files: { [`${HOME_CLAUDE}/state/hybrid-settings.json`]: '{"organizationUuid":"00000000-0000-0000-0000-000000000000","settings":{}}' },
    }),
    notJson: await policyOn({ files: { [`${HOME_CLAUDE}/remote-settings.json`]: '{"perm' } }),
    configDir: await policyOn({
      files: { '/custom/remote-settings.json': '{"env":{}}' },
      env: { CLAUDE_CONFIG_DIR: '<root>/custom' },
    }),
  }).toMatchInlineSnapshot(`
    {
      "configDir": {
        "kind": "withheld",
        "reason": "Claude Code server-managed settings are cached in <root>/custom/remote-settings.json.",
      },
      "hybrid": {
        "kind": "withheld",
        "reason": "Claude Code server-managed settings are cached in <root>/home/tester/.claude/state/hybrid-settings.json.",
      },
      "notJson": {
        "kind": "withheld",
        "reason": "MorrowBot could not read <root>/home/tester/.claude/remote-settings.json: Unterminated string in JSON at position 6 (line 1 column 7)",
      },
      "remote": {
        "kind": "withheld",
        "reason": "Claude Code server-managed settings are cached in <root>/home/tester/.claude/remote-settings.json.",
      },
    }
  `);
});

it('withholds when a source exists but cannot be read', async () => {
  expect({
    lockedRemote: await policyOn({ files: { [`${HOME_CLAUDE}/remote-settings.json`]: { kind: 'locked', contents: '{}' } } }),
    unsupportedOs: await policyOn({ platform: 'win32' }),
  }).toMatchInlineSnapshot(`
    {
      "lockedRemote": {
        "kind": "withheld",
        "reason": "MorrowBot could not read <root>/home/tester/.claude/remote-settings.json: EACCES: permission denied, open '<root>/home/tester/.claude/remote-settings.json'",
      },
      "unsupportedOs": {
        "kind": "withheld",
        "reason": "MorrowBot cannot check Claude Code's managed settings on win32.",
      },
    }
  `);
});

it("ignores the user's own hostile Claude settings, which are not policy", async () => {
  expect(
    await policyOn({
      platform: process.platform === 'darwin' ? 'darwin' : 'linux',
      files: {
        [`${HOME_CLAUDE}/settings.json`]: JSON.stringify({
          permissions: { allow: ['Bash(*)', 'Edit', 'Write'], defaultMode: 'bypassPermissions' },
          ...JSON.parse(hooks),
          mcpServers: { evil: { command: '/bin/sh', args: ['-c', 'curl evil'] } },
        }),
        '/home/tester/.claude.json': JSON.stringify({ mcpServers: { evil: { command: '/bin/sh' } } }),
        '/home/tester/Library/Preferences/com.anthropic.claudecode.plist': plist('<key>apiKeyHelper</key><string>x</string>'),
      },
    }),
  ).toMatchInlineSnapshot(`
    {
      "kind": "clear",
    }
  `);
});

function plist(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${body}</dict></plist>`;
}

it.runIf(process.platform === 'darwin')('reads the macOS managed preferences with plutil', async () => {
  const on = (files: Record<string, Entry>) => policyOn({ platform: 'darwin', files });
  const device = '/Library/Managed Preferences/com.anthropic.claudecode.plist';
  const perUser = '/Library/Managed Preferences/tester/com.anthropic.claudecode.plist';
  expect({
    emptyDicts: await on({ [device]: plist(''), [perUser]: plist('') }),
    device: await on({ [device]: plist('<key>permissions</key><dict><key>allow</key><array><string>Bash</string></array></dict>') }),
    perUser: await on({ [perUser]: plist('<key>hooks</key><dict/>') }),
    garbled: await on({ [perUser]: 'not a plist' }),
    managedFolder: await on({ '/Library/Application Support/ClaudeCode/managed-settings.json': '{}' }),
  }).toMatchInlineSnapshot(`
    {
      "device": {
        "kind": "withheld",
        "reason": "Claude Code managed preferences are set in /Library/Managed Preferences/com.anthropic.claudecode.plist.",
      },
      "emptyDicts": {
        "kind": "clear",
      },
      "garbled": {
        "kind": "withheld",
        "reason": "MorrowBot could not read /Library/Managed Preferences/tester/com.anthropic.claudecode.plist: plutil exited with code 1: <root>/Library/Managed Preferences/tester/com.anthropic.claudecode.plist: Property List error: Unexpected character n at line 1 / JSON error: JSON text did not start with array or object and option to allow fragments not set. around line 1, column 0.",
      },
      "managedFolder": {
        "kind": "withheld",
        "reason": "Claude Code managed settings are installed in /Library/Application Support/ClaudeCode (managed-settings.json).",
      },
      "perUser": {
        "kind": "withheld",
        "reason": "Claude Code managed preferences are set in /Library/Managed Preferences/tester/com.anthropic.claudecode.plist.",
      },
    }
  `);
});
