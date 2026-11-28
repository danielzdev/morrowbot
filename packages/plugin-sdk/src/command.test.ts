import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OPEN } from './fence.ts';
import { commandFilePath, createCommandRunner, LINE_LIMIT, PROBE_OUTPUT_LIMIT, type CommandExit, type CommandOptions } from './command.ts';
import { createGroupLink } from './host-link.ts';
import { waitUntilGone } from './testing/processes.ts';

/** These tests own the commands themselves: with no host connected, groups are acknowledged at once. */
const commands = createCommandRunner(createGroupLink(), process.env, OPEN);
let work: string;
beforeEach(async () => {
  work = await realpath(await mkdtemp(path.join(tmpdir(), 'orikami-sdk-command-')));
});
afterEach(async () => {
  await commands.stopAll();
  await rm(work, { recursive: true, force: true });
});

function options(overrides: Partial<CommandOptions> & { readonly args: readonly string[] }): CommandOptions {
  return { cwd: work, files: [], scope: { kind: 'probe' }, signal: new AbortController().signal, onLine: () => undefined, ...overrides };
}

async function run(
  command: string,
  args: readonly string[],
  { input = '', files = [] }: { readonly input?: string; readonly files?: readonly string[] } = {},
): Promise<{ lines: string[]; exit: CommandExit; ms: number }> {
  const lines: string[] = [];
  const started = performance.now();
  const exit = await commands.run(command, { ...options({ args, files, onLine: (line) => lines.push(line) }), input });
  return { lines, exit, ms: performance.now() - started };
}

it('returns a short command at once, with its output and exit', async () => {
  const { lines, exit, ms } = await run('/bin/echo', ['hello']);
  expect({ lines, exit, underHalfASecond: ms < 500 }).toMatchInlineSnapshot(`
    {
      "exit": {
        "code": 0,
        "kind": "exited",
        "signal": null,
        "stderr": "",
      },
      "lines": [
        "hello",
      ],
      "underHalfASecond": true,
    }
  `);
});

it('stops a command whose stdout line runs past the limit, ended by a newline or not, keeping the lines before it', async () => {
  const xs = `head -c ${String(LINE_LIMIT)} /dev/zero | tr '\\0' x`;
  const turn = async (script: string) => {
    const lines: string[] = [];
    const started = performance.now();
    const exit = await commands.run('/bin/sh', {
      ...options({ args: ['-c', `printf 'first\\n'; ${xs}; ${script}; sleep 30`], scope: { kind: 'turn', turnId: 'turn-1' } }),
      onLine: (line) => lines.push(line.slice(0, 10)),
      input: '',
    });
    return { lines, exit, beforeTheSleepEnds: performance.now() - started < 20_000 };
  };
  expect({ unterminated: await turn("printf 'y'"), terminated: await turn("printf 'y\\nafter\\n'") }).toMatchInlineSnapshot(`
    {
      "terminated": {
        "beforeTheSleepEnds": true,
        "exit": {
          "kind": "failed",
          "message": "The command printed a line longer than 67108864 characters",
        },
        "lines": [
          "first",
        ],
      },
      "unterminated": {
        "beforeTheSleepEnds": true,
        "exit": {
          "kind": "failed",
          "message": "The command printed a line longer than 67108864 characters",
        },
        "lines": [
          "first",
        ],
      },
    }
  `);
});

it('stops a probe that prints more than its budget in all, but not a turn command printing as much', async () => {
  const exitOf = (scope: CommandOptions['scope']) =>
    commands.run('/bin/sh', { ...options({ args: ['-c', `yes | head -c ${String(PROBE_OUTPUT_LIMIT + 2)}; sleep 2`], scope }), input: '' });
  expect({ probe: await exitOf({ kind: 'probe' }), turn: await exitOf({ kind: 'turn', turnId: 'turn-1' }) }).toMatchInlineSnapshot(`
    {
      "probe": {
        "kind": "failed",
        "message": "The probe printed more than 16777216 characters",
      },
      "turn": {
        "code": 0,
        "kind": "exited",
        "signal": null,
        "stderr": "",
      },
    }
  `);
});

it('kills what the command left running in its group as soon as the command exits', async () => {
  const { lines, exit, ms } = await run('/bin/sh', ['-c', 'sleep 30 & echo $!']);
  const grandchild = Number(lines[0]);
  expect({ exit, beforeTheSleepEnds: ms < 10_000, after: await waitUntilGone({ grandchild }) }).toMatchInlineSnapshot(`
    {
      "after": {
        "grandchild": "gone",
      },
      "beforeTheSleepEnds": true,
      "exit": {
        "code": 0,
        "kind": "exited",
        "signal": null,
        "stderr": "",
      },
    }
  `);
});

it('removes ELECTRON_RUN_AS_NODE from the command environment and keeps the rest', async () => {
  process.env.ELECTRON_RUN_AS_NODE = '1';
  process.env.ORIKAMI_TEST_MARK = 'kept';
  try {
    const { lines } = await run('/usr/bin/env', []);
    expect(lines.filter((line) => /^(ELECTRON_RUN_AS_NODE|ORIKAMI_TEST_MARK)=/.test(line))).toMatchInlineSnapshot(`
      [
        "ORIKAMI_TEST_MARK=kept",
      ]
    `);
  } finally {
    delete process.env.ELECTRON_RUN_AS_NODE;
    delete process.env.ORIKAMI_TEST_MARK;
  }
});

it("gives a command its own variables on top of the runtime's, replacing one of the same name", async () => {
  process.env.ORIKAMI_TEST_MARK = 'runtime';
  try {
    const lines: string[] = [];
    await commands.run('/usr/bin/env', { ...options({ args: [], onLine: (line) => lines.push(line) }), env: { ORIKAMI_TEST_MARK: 'own', ORIKAMI_TEST_EXTRA: 'added' }, input: '' });
    const unchanged: string[] = [];
    await commands.run('/usr/bin/env', { ...options({ args: [], onLine: (line) => unchanged.push(line) }), input: '' });
    const marks = (printed: readonly string[]): string[] => printed.filter((line) => line.startsWith('ORIKAMI_TEST_')).sort();
    expect({ own: marks(lines), next: marks(unchanged) }).toMatchInlineSnapshot(`
      {
        "next": [
          "ORIKAMI_TEST_MARK=runtime",
        ],
        "own": [
          "ORIKAMI_TEST_EXTRA=added",
          "ORIKAMI_TEST_MARK=own",
        ],
      }
    `);
  } finally {
    delete process.env.ORIKAMI_TEST_MARK;
  }
});

it('starts the guard without the command\'s own variables, so they cannot change how it starts', async () => {
  const lines: string[] = [];
  const exit = await commands.run('/bin/sh', { ...options({ args: ['-c', 'echo "$NODE_OPTIONS"'], onLine: (line) => lines.push(line) }), env: { NODE_OPTIONS: '--no-such-flag' }, input: '' });
  expect({ exit: exit.kind === 'exited' ? exit.code : exit.kind, lines }).toMatchInlineSnapshot(`
    {
      "exit": 0,
      "lines": [
        "--no-such-flag",
      ],
    }
  `);
});

it('passes stdin and input files to the command', async () => {
  const { lines } = await run('/bin/sh', ['-c', 'cat; echo; cat "$1"; echo; cat "$2"', 'sh', commandFilePath(0), commandFilePath(1)], {
    input: 'from stdin',
    files: ['first file', 'second\nfile'],
  });
  expect(lines).toMatchInlineSnapshot(`
    [
      "from stdin",
      "first file",
      "second",
      "file",
    ]
  `);
});

/** Starts `command`, waits for its first line, aborts it, and reports what it printed and how long it took to stop. */
async function abortAfterFirstLine(command: string, args: readonly string[]): Promise<{ lines: string[]; exit: CommandExit; ms: number }> {
  const controller = new AbortController();
  const lines: string[] = [];
  const ready = Promise.withResolvers<number>();
  const opened = commands.open(command, {
    ...options({ args, signal: controller.signal }),
    onLine: (line) => {
      lines.push(line);
      ready.resolve(performance.now());
    },
  });
  await ready.promise;
  const aborted = performance.now();
  controller.abort();
  const exit = await opened.exited;
  return { lines, exit, ms: performance.now() - aborted };
}

it('on abort sends SIGTERM, then SIGKILL a second later to a command that ignores it', async () => {
  const { lines, exit, ms } = await abortAfterFirstLine('/bin/sh', [
    '-c',
    'trap "echo got SIGTERM" TERM; echo ready; while :; do sleep 0.05; done',
  ]);
  expect({ lines, exit: exit.kind === 'exited' ? { kind: exit.kind, signal: exit.signal } : exit.kind, waitedTheGrace: ms >= 950, underTwoSeconds: ms < 2_000 }).toMatchInlineSnapshot(`
    {
      "exit": {
        "kind": "exited",
        "signal": "SIGKILL",
      },
      "lines": [
        "ready",
        "got SIGTERM",
      ],
      "underTwoSeconds": true,
      "waitedTheGrace": true,
    }
  `);
});

it('on abort stops a command that exits on SIGTERM without waiting for the grace second', async () => {
  const { exit, ms } = await abortAfterFirstLine('/bin/sh', ['-c', 'echo ready; exec sleep 30']);
  expect({ exit, underHalfASecond: ms < 500 }).toMatchInlineSnapshot(`
    {
      "exit": {
        "code": null,
        "kind": "exited",
        "signal": "SIGTERM",
        "stderr": "",
      },
      "underHalfASecond": true,
    }
  `);
});

it('does not delay one command while another hangs', async () => {
  const controller = new AbortController();
  let hungSettled = false;
  const hung = commands.open('/bin/sleep', options({ args: ['30'], signal: controller.signal }));
  void hung.exited.then(() => (hungSettled = true));
  const quick = await run('/bin/echo', ['done']);
  const whileHung = { quick: quick.lines, hungSettled };
  controller.abort();
  const exit = await hung.exited;
  expect({ whileHung, hung: exit.kind }).toMatchInlineSnapshot(`
    {
      "hung": "exited",
      "whileHung": {
        "hungSettled": false,
        "quick": [
          "done",
        ],
      },
    }
  `);
});

it('never signals a process group from the plugin process', async () => {
  const kill = vi.spyOn(process, 'kill');
  try {
    await run('/bin/sh', ['-c', 'sleep 30 & echo started']);
    const aborted = new AbortController();
    const cancelled = commands.open('/bin/sleep', options({ args: ['30'], signal: aborted.signal }));
    setTimeout(() => {
      aborted.abort();
    }, 200);
    await cancelled.exited;
    const stopped = commands.open('/bin/sleep', options({ args: ['30'] }));
    setTimeout(() => void commands.stopAll(), 200);
    await stopped.exited;
    expect(kill.mock.calls).toEqual([]);
  } finally {
    kill.mockRestore();
  }
});

it('reports a missing program as not-found and an aborted signal as an immediate exit', async () => {
  const aborted = new AbortController();
  aborted.abort();
  expect({
    missing: await commands.run(path.join(work, 'no-such-cli'), { ...options({ args: [] }), input: '' }),
    preAborted: await commands.run('/bin/echo', { ...options({ args: ['x'], signal: aborted.signal }), input: '' }),
  }).toMatchInlineSnapshot(`
    {
      "missing": {
        "kind": "not-found",
      },
      "preAborted": {
        "code": null,
        "kind": "exited",
        "signal": null,
        "stderr": "",
      },
    }
  `);
});

it('abandon closes every owner pipe: each guard sweeps its group, and no command starts afterwards', async () => {
  const owner = createCommandRunner(createGroupLink(), process.env, OPEN);
  const ready = Promise.withResolvers<number>();
  const opened = owner.open('/bin/sh', {
    ...options({ args: ['-c', 'sleep 30 & echo $!; wait'] }),
    onLine: (line) => {
      ready.resolve(Number(line));
    },
  });
  const grandchild = await ready.promise;
  owner.abandon();
  const exit = await opened.exited;
  expect({
    exit: exit.kind === 'exited' ? { kind: exit.kind, signal: exit.signal } : exit,
    after: await waitUntilGone({ grandchild }),
    later: await owner.run('/bin/echo', { ...options({ args: ['x'] }), input: '' }),
  }).toMatchInlineSnapshot(`
    {
      "after": {
        "grandchild": "gone",
      },
      "exit": {
        "kind": "exited",
        "signal": "SIGKILL",
      },
      "later": {
        "kind": "failed",
        "message": "The plugin has stopped",
      },
    }
  `);
});
