import { commandFilePath, defineProvider, runPlugin, z } from '../index.ts';

/**
 * A plugin process for SDK tests, started by `startPlugin`. `tool` serves a tool plugin; anything
 * else serves a provider whose turn runs the command given as JSON in the prompt and ends with
 * the command's exit as `finalText`.
 */
const TurnSpec = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('command'),
    command: z.string(),
    args: z.array(z.string()),
    files: z.array(z.string()),
  }),
  z.strictObject({ kind: z.literal('throw'), message: z.string() }),
  z.strictObject({ kind: z.literal('ask'), summary: z.string().min(1) }),
]);

function fileArgs(args: readonly string[]): string[] {
  return args.map((arg) => arg.replace(/\{file(\d+)\}/g, (_match, index: string) => commandFilePath(Number(index))));
}

if (process.argv[2] === 'tool') {
  runPlugin(() => ({ kind: 'tool' }));
} else {
  runPlugin((runtime) =>
    defineProvider({
      providerInfo: () => {
        throw new Error('provider info is not set up in this fixture');
      },
      usage: () => ({ kind: 'unavailable', observedAt: new Date(0).toISOString(), accountKey: '', reason: 'unsupported' }),
      routeInfo: () => ({ kind: 'failed', reason: 'not set up in this fixture' }),
      turn: async (context) => {
        const { request, signal } = context;
        const prompt: unknown = JSON.parse(request.prompt);
        const spec = TurnSpec.parse(prompt);
        if (spec.kind === 'throw') throw new Error(spec.message);
        if (spec.kind === 'ask') {
          const answer = await context.ask({ summary: spec.summary, choices: [{ id: 'allow', label: 'Allow' }] });
          return {
            outcome: signal.aborted ? { kind: 'cancelled' } : { kind: 'completed', finishReason: 'stop' },
            usage: { kind: 'unavailable' },
            actualModel: null,
            accountKey: '',
            sessionTouched: false,
            finalText: JSON.stringify(answer),
          };
        }
        const exit = await runtime.openCommand(spec.command, {
          args: fileArgs(spec.args),
          cwd: request.cwd,
          files: spec.files,
          scope: { kind: 'turn', turnId: request.turnId },
          signal,
          onLine: (text) => {
            context.emit({ kind: 'text', text });
          },
        }).exited;
        return {
          outcome: signal.aborted ? { kind: 'cancelled' } : { kind: 'completed', finishReason: 'stop' },
          usage: { kind: 'unavailable' },
          actualModel: null,
          accountKey: '',
          sessionTouched: false,
          finalText: JSON.stringify(exit),
        };
      },
    }),
  );
}
