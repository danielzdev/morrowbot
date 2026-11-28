import { z } from 'zod';
import type { ServerAnswer as ServerAnswerType, ServerMode as ServerModeType } from '../bridge.ts';

/** Parses `bridge.serverMode()`. */
export const ServerMode: z.ZodType<ServerModeType> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('choosing') }),
  z.strictObject({ kind: z.literal('local') }),
  z.strictObject({ kind: z.literal('remote'), url: z.string(), hostName: z.string() }),
]);

/** Parses `bridge.chooseServer()`. */
export const ServerAnswer: z.ZodType<ServerAnswerType> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ready') }),
  z.strictObject({ kind: z.literal('restarting') }),
  z.strictObject({ kind: z.literal('failed'), message: z.string() }),
]);

/** What a server choice ended in, as a line to show, or null once it took effect. */
export function answerProblem(reply: unknown): string | null {
  const answer = ServerAnswer.safeParse(reply);
  if (!answer.success) return "Ori Kami couldn't switch servers. Try again.";
  return answer.data.kind === 'failed' ? answer.data.message : null;
}
