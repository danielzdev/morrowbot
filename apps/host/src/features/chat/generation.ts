import type {
  AgentTools,
  AssistantMessage,
  ChatEvent,
  ChatProvider,
  GenerationOutcome,
  Message,
  ProviderEvent,
} from '@morrowbot/contracts';

export interface GenerationInput {
  readonly generationId: string;
  readonly threadId: string;
  readonly provider: ChatProvider;
  readonly model: string;
  readonly history: readonly Message[];
  readonly loadInstructions: () => Promise<string>;
  readonly tools: AgentTools;
  readonly signal: AbortSignal;
  readonly publish: (event: ChatEvent) => void;
}

export type GenerationResult = { readonly text: string; readonly outcome: GenerationOutcome };

const ABORTED = Symbol('aborted');

/** Streams one provider reply. Never throws; a stop or failure becomes the outcome. */
export async function generate(input: GenerationInput): Promise<GenerationResult> {
  const { signal } = input;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    if (signal.aborted) resolve(ABORTED);
    else
      signal.addEventListener(
        'abort',
        () => {
          resolve(ABORTED);
        },
        { once: true },
      );
  });
  let text = '';
  try {
    const instructions = await Promise.race([input.loadInstructions(), aborted]);
    if (instructions === ABORTED) return { text, outcome: { kind: 'stopped' } };
    const stream = input.provider.generate({
      model: input.model,
      instructions,
      messages: input.history,
      tools: input.tools,
      signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    for (;;) {
      const next: IteratorResult<ProviderEvent> | typeof ABORTED = await Promise.race([iterator.next(), aborted]);
      if (next === ABORTED) {
        void iterator.return?.().catch(() => undefined);
        return { text, outcome: { kind: 'stopped' } };
      }
      if (next.done === true) break;
      if (next.value.text === '') continue;
      text += next.value.text;
      input.publish({
        kind: 'generation.delta',
        threadId: input.threadId,
        generationId: input.generationId,
        text: next.value.text,
      });
    }
    return { text, outcome: signal.aborted ? { kind: 'stopped' } : { kind: 'completed' } };
  } catch (error) {
    if (signal.aborted) return { text, outcome: { kind: 'stopped' } };
    return { text, outcome: { kind: 'failed', error: error instanceof Error ? error.message : String(error) } };
  }
}

export function assistantMessage(
  id: string,
  threadId: string,
  result: GenerationResult,
  createdAt: string,
): AssistantMessage {
  return { kind: 'assistant', id, threadId, text: result.text, outcome: result.outcome, createdAt };
}
