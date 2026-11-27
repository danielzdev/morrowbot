import { chmod, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { standaloneRuntime } from './runtime.ts';
import { checkVersion } from './version.ts';

const { readCliVersion } = standaloneRuntime();

let base: string;
beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'morrowbot-sdk-version-')));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

it('places versions against a tested range', () => {
  const range = { atLeast: '2.1.332', below: '2.2.0' };
  const versions = ['2.1.331', '2.1.332', '2.1.332 (Claude Code)', ' 2.1.999\n', '2.2.0', '2.10.0', '3.0.0', 'v2.1.400', '2.1', ''];
  expect(Object.fromEntries(versions.map((version) => [version, checkVersion(version, range)]))).toMatchInlineSnapshot(`
    {
      "": "unparsable",
      " 2.1.999
    ": "inside",
      "2.1": "unparsable",
      "2.1.331": "below",
      "2.1.332": "inside",
      "2.1.332 (Claude Code)": "inside",
      "2.10.0": "above",
      "2.2.0": "above",
      "3.0.0": "above",
      "v2.1.400": "unparsable",
    }
  `);
});

/** A fake CLI that prints `output` for `--version` and counts its runs in `runs`. */
async function writeCli(output: string, mtime: number): Promise<string> {
  const cli = path.join(base, 'fake-cli');
  await writeFile(cli, `#!/bin/sh\necho run >> "${base}/runs"\necho "${output}"\n`);
  await chmod(cli, 0o755);
  await utimes(cli, mtime, mtime);
  return cli;
}

async function runs(): Promise<number> {
  return (await readFile(path.join(base, 'runs'), 'utf8').catch(() => '')).split('\n').filter((line) => line !== '').length;
}

it('caches the version by path, mtime and size', async () => {
  const cli = await writeCli('fake-cli 2.1.400 (test)', 1_000);
  const steps: Record<string, unknown> = {};
  const step = async (name: string) => {
    steps[name] = { result: await readCliVersion(cli, { cwd: base }), runs: await runs() };
  };
  await step('first');
  await step('again');
  await writeCli('fake-cli 2.1.402 (test)', 2_000);
  await step('new mtime');
  await writeCli('fake-cli 2.1.4033 (test)', 2_000);
  await step('new size');
  expect(steps).toMatchInlineSnapshot(`
    {
      "again": {
        "result": {
          "kind": "version",
          "version": "2.1.400",
        },
        "runs": 1,
      },
      "first": {
        "result": {
          "kind": "version",
          "version": "2.1.400",
        },
        "runs": 1,
      },
      "new mtime": {
        "result": {
          "kind": "version",
          "version": "2.1.402",
        },
        "runs": 2,
      },
      "new size": {
        "result": {
          "kind": "version",
          "version": "2.1.4033",
        },
        "runs": 3,
      },
    }
  `);
});

it('reports a missing CLI and one that prints no version', async () => {
  const cli = await writeCli('no version here', 1_000);
  const results = {
    missing: await readCliVersion(path.join(base, 'no-such-cli'), { cwd: base }),
    noVersion: await readCliVersion(cli, { cwd: base }),
  };
  expect(JSON.parse(JSON.stringify(results).replaceAll(base, '<base>'))).toMatchInlineSnapshot(`
    {
      "missing": {
        "kind": "missing",
      },
      "noVersion": {
        "kind": "failed",
        "message": ""<base>/fake-cli --version" printed no version",
      },
    }
  `);
});

it('reads a long run of digits in linear time, finding no version in it', async () => {
  const cli = path.join(base, 'digits-cli');
  await writeFile(cli, `#!/bin/sh\nhead -c 1000000 /dev/zero | tr '\\0' 7\necho\n`);
  await chmod(cli, 0o755);
  const started = performance.now();
  const result = await readCliVersion(cli, { cwd: base });
  const ms = performance.now() - started;
  expect({ result: result.kind === 'failed' ? result.message.replaceAll(base, '<base>') : result, underTwoSeconds: ms < 2_000 }).toMatchInlineSnapshot(`
    {
      "result": ""<base>/digits-cli --version" printed no version",
      "underTwoSeconds": true,
    }
  `);
});
