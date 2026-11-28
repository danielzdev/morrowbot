import type { TurnContext, UsageWindow } from '@morrowbot/plugin-sdk';
import { APPROVAL_CHOICES, controlResponse, type ControlRequest } from './control.ts';
import { createTurnReader, type TurnReader } from './reader.ts';

/** Hears plan usage from a turn's `rate_limit_event`s, for the account the turn was checked against. */
export type UsageListener = (accountKey: string, observedAt: string, windows: readonly UsageWindow[]) => void;

/** One turn's side of the stream-json wire, apart from the process that carries it. */
export interface WireOptions {
  readonly home: string | null;
  /** The account the turn was checked against; it labels the turn's usage updates. */
  readonly accountKey: string;
  /** Whether a `can_use_tool` request may reach the user. When false it is denied without a card. */
  readonly asks: boolean;
  readonly ask: TurnContext['ask'];
  readonly emit: TurnContext['emit'];
  readonly onUsage: UsageListener;
  /** Writes a line to the CLI's stdin. */
  readonly write: (line: string) => void;
  /** Closes the CLI's stdin. */
  readonly end: () => void;
}

/**
 * Reads the CLI's stdout lines: emits the turn's chunks and usage, answers each control request on
 * stdin once the user has chosen, and closes stdin after the `result`.
 */
export function createTurnWire(options: WireOptions): TurnReader {
  const answer = async (control: ControlRequest): Promise<void> => {
    const choice =
      control.kind === 'can-use-tool' && options.asks ? await options.ask({ summary: control.summary, choices: APPROVAL_CHOICES }) : null;
    const response = controlResponse(control, choice);
    if (response !== null) options.write(response);
  };
  return createTurnReader(
    { home: options.home },
    {
      emit: options.emit,
      usage: (windows) => {
        const observedAt = new Date().toISOString();
        options.onUsage(options.accountKey, observedAt, windows);
        options.emit({ kind: 'usage-update', observedAt, accountKey: options.accountKey, windows: [...windows] });
      },
      control: (control) => {
        answer(control).catch((error: unknown) => {
          console.error('provider-claude: could not answer a control request', error);
        });
      },
      done: options.end,
    },
  );
}
