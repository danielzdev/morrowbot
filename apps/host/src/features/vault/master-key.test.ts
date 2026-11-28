import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dpapiArgs, dpapiKeyStore } from './dpapi-key.ts';
import { keychainKeyStore } from './keychain-key.ts';
import { newMasterKey } from './master-key.ts';
import { runProgram, type Run, type RunResult } from './run.ts';
import { linuxKeys } from './secret-service-key.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'morrowbot-vault-key-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly input: string;
}

/** A stand-in for one helper program: records each call and answers with `answer`. */
function fakeProgram(answer: (call: Call) => RunResult): { readonly run: Run; readonly calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    run: (command, args, input) => {
      const call = { command, args, input };
      calls.push(call);
      return Promise.resolve(answer(call));
    },
  };
}

const exited = (code: number, stdout = '', stderr = ''): RunResult => ({ kind: 'exited', code, stdout, stderr });
const failure = (work: Promise<unknown>): Promise<string> =>
  work.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

it('keeps the macOS master key in one Keychain item, passing it only on stdin', async () => {
  const key = newMasterKey();
  let saved: string | undefined;
  const security = fakeProgram(({ args, input }) => {
    if (args[0] === '-i') {
      saved = /-w (\S+)\n$/.exec(input)?.[1];
      return exited(0);
    }
    return saved === undefined ? exited(44) : exited(0, `${saved}\n`);
  });
  const store = keychainKeyStore('com.legendarykoi.morrowbot.vault', security.run);
  const before = await store.load();
  await store.save(key);
  const loaded = await store.load();
  const keyText = key.toString('base64');
  expect({
    before,
    roundTrip: loaded?.equals(key),
    keyInArguments: security.calls.some(({ args }) => args.some((arg) => arg.includes(keyText))),
    calls: security.calls.map(({ command, args, input }) => `${command} ${args.join(' ')}${input === '' ? '' : ` <<< ${input.replace(keyText, '<key>').trim()}`}`),
  }).toEqual({
    before: undefined,
    roundTrip: true,
    keyInArguments: false,
    calls: [
      '/usr/bin/security find-generic-password -s com.legendarykoi.morrowbot.vault -a master-key -w',
      '/usr/bin/security -i <<< add-generic-password -U -s com.legendarykoi.morrowbot.vault -a master-key -w <key>',
      '/usr/bin/security find-generic-password -s com.legendarykoi.morrowbot.vault -a master-key -w',
    ],
  });
});

it('wraps the Windows master key with DPAPI for the current user, keeping only the wrapped bytes on disk', async () => {
  const key = newMasterKey();
  const wrap = (text: string): string => Buffer.from(`wrapped:${text}`).toString('base64');
  const unwrap = (text: string): string => Buffer.from(text, 'base64').toString('utf8').replace(/^wrapped:/, '');
  const powershell = fakeProgram(({ args, input }) => exited(0, args.at(-1) === dpapiArgs('Protect').at(-1) ? wrap(input) : unwrap(input)));
  const file = path.join(dir, 'vault.key.dpapi');
  const store = dpapiKeyStore(file, powershell.run);
  const before = await store.load();
  await store.save(key);
  const onDisk = await readFile(file, 'utf8');
  const loaded = await store.load();
  const scriptOf = (args: readonly string[]): string => Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le');
  expect({
    before,
    roundTrip: loaded?.equals(key),
    plainKeyOnDisk: onDisk.includes(key.toString('base64')),
    keyInArguments: powershell.calls.some(({ args }) => args.some((arg) => arg.includes(key.toString('base64')))),
    commands: powershell.calls.map(({ command, args }) => `${command} ${args.slice(0, -1).join(' ')} <${scriptOf(args).includes('::Protect(') ? 'Protect' : 'Unprotect'}>`),
    protect: scriptOf(dpapiArgs('Protect')),
  }).toMatchInlineSnapshot(`
    {
      "before": undefined,
      "commands": [
        "powershell.exe -NoProfile -NonInteractive -EncodedCommand <Protect>",
        "powershell.exe -NoProfile -NonInteractive -EncodedCommand <Unprotect>",
      ],
      "keyInArguments": false,
      "plainKeyOnDisk": false,
      "protect": "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security; $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($out))",
      "roundTrip": true,
    }
  `);
});

it('uses the Linux Secret Service when secret-tool reaches it, and says why it falls back to a key file otherwise', async () => {
  const key = newMasterKey();
  let stored: string | undefined;
  const reachable = fakeProgram(({ args, input }) => {
    if (args[0] === 'store') {
      stored = input;
      return exited(0);
    }
    return exited(stored === undefined ? 1 : 0, stored ?? '');
  });
  const linux = await linuxKeys(path.join(dir, 'vault.key'), reachable.run);
  await linux.store.save(key);
  const roundTrip = (await linux.store.load())?.equals(key);
  const keyFile = path.join(dir, 'existing.key');
  await writeFile(keyFile, `${newMasterKey().toString('base64')}\n`);
  const why = async (run: Run, file = path.join(dir, 'vault.key')) => {
    const chosen = await linuxKeys(file, run);
    return chosen.kind === 'headless' ? `${chosen.store.kind}: ${chosen.reason}` : chosen.store.kind;
  };
  expect({
    reachable: linux.kind,
    roundTrip,
    calls: reachable.calls.map(({ args, input }) => `secret-tool ${args.join(' ')}${input === '' ? '' : ' <<< <key>'}`),
    notInstalled: await why(fakeProgram(() => ({ kind: 'missing' })).run),
    noSession: await why(fakeProgram(() => exited(1, '', 'Cannot autolaunch D-Bus without X11 $DISPLAY')).run),
    keyFileAlreadyThere: await why(reachable.run, keyFile),
  }).toEqual({
    reachable: 'secret-service',
    roundTrip: true,
    calls: [
      'secret-tool lookup service com.legendarykoi.morrowbot.vault account master-key',
      'secret-tool store --label=MorrowBot vault key service com.legendarykoi.morrowbot.vault account master-key <<< <key>',
      'secret-tool lookup service com.legendarykoi.morrowbot.vault account master-key',
    ],
    notInstalled: 'key-file: secret-tool is not installed',
    noSession: 'key-file: the Secret Service is not reachable from this session',
    keyFileAlreadyThere: 'key-file: the vault key is in the data folder from an earlier run without a Secret Service',
  });
});

it('names the failing tool, never the key, when a keystore refuses', async () => {
  const refuse = fakeProgram(() => exited(1, '', 'some secret-looking stderr'));
  const key = newMasterKey();
  const messages = [
    await failure(keychainKeyStore(undefined, refuse.run).save(key)),
    await failure(dpapiKeyStore(path.join(dir, 'k.dpapi'), refuse.run).save(key)),
    await failure((await linuxKeys(path.join(dir, 'none.key'), fakeProgram(({ args }) => (args[0] === 'lookup' ? exited(1) : exited(1, '', 'stderr'))).run)).store.save(key)),
  ];
  expect(messages).toEqual([
    'The macOS Keychain could not save the vault key (security exited with 1)',
    'Windows DPAPI could not protect the vault key (PowerShell exited with 1)',
    'The Secret Service could not save the vault key (secret-tool exited with 1)',
  ]);
});

/** Writes to the real login Keychain, so it runs only on macOS with `MORROWBOT_LIVE_KEYCHAIN=1`. */
const LIVE = process.platform === 'darwin' && process.env.MORROWBOT_LIVE_KEYCHAIN === '1';

describe.runIf(LIVE)('the master key in this Mac’s login Keychain', () => {
  it('saves one key under a throwaway service and reads it back', async () => {
    const service = `com.legendarykoi.morrowbot.vault.test-${randomUUID()}`;
    const store = keychainKeyStore(service);
    const key = newMasterKey();
    try {
      const before = await store.load();
      await store.save(key);
      expect({ before, roundTrip: (await store.load())?.equals(key) }).toEqual({ before: undefined, roundTrip: true });
    } finally {
      await runProgram('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', 'master-key'], '');
    }
    expect(await store.load()).toBeUndefined();
  });
});
