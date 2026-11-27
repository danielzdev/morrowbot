import type { FinishReason, ProviderError, SessionChoice, TurnOutcome } from '@morrowbot/contracts';

export type Tone = 'normal' | 'muted' | 'warning' | 'error';

/** What Continue on this reply does, when it is offered. */
export interface ContinueOffer {
  readonly label: string;
  readonly sessionChoice: SessionChoice;
  /** Shown next to the button, e.g. why a new session is needed. */
  readonly prompt: string | null;
}

/** How a finished reply is labelled under its text. */
export interface OutcomeNote {
  readonly tone: Tone;
  /** Null for a normal, complete reply. */
  readonly label: string | null;
  /** A rate limit's reset time, to show in the user's own clock. */
  readonly resetsAt: string | null;
  /** Offered only on the thread's latest reply. */
  readonly continueOffer: ContinueOffer | null;
}

const CONTINUE: ContinueOffer = { label: 'Continue', sessionChoice: { kind: 'auto' }, prompt: null };

export function describeOutcome(outcome: TurnOutcome): OutcomeNote {
  switch (outcome.kind) {
    case 'completed':
      return describeFinish(outcome.finishReason);
    case 'cancelled':
      return note('muted', 'Stopped.');
    case 'interrupted':
      return note('warning', 'Interrupted: MorrowBot stopped before this reply finished.', CONTINUE);
    case 'failed':
      return describeError(outcome.error);
  }
}

function describeFinish(reason: FinishReason): OutcomeNote {
  switch (reason) {
    case 'stop':
      return note('normal', null);
    case 'length':
      return note('warning', 'The reply hit its length limit.', CONTINUE);
    case 'refused':
      return note('warning', 'The model declined to answer.');
    case 'turn-limit':
      return note('warning', 'The reply hit its turn limit.', CONTINUE);
  }
}

function describeError(error: ProviderError): OutcomeNote {
  switch (error.kind) {
    case 'rate-limited':
      return { ...note('warning', 'Usage limit reached.', CONTINUE), resetsAt: error.resetsAt };
    case 'signed-out':
      return note('error', 'Signed out. Sign in from the Plugins page, then Continue.', CONTINUE);
    case 'account-changed':
      return note('error', 'The provider is now signed in to a different account. Check the Plugins page, then Continue.', CONTINUE);
    case 'not-installed':
      return note('error', 'The provider CLI is not installed. See the Plugins page.', CONTINUE);
    case 'outdated':
      return note('error', 'The provider CLI is outdated. See the Plugins page.', CONTINUE);
    case 'invalid-model':
      return note('error', 'The provider does not know this model. Pick another one, then Continue.', CONTINUE);
    case 'transient':
      return note('warning', 'The provider had a temporary problem.', CONTINUE);
    case 'session-lost':
      return note('error', 'The provider lost its saved session.', CONTINUE);
    case 'route-changed':
      return note('warning', "The provider's endpoint changed.", {
        label: 'Start new seeded session',
        sessionChoice: { kind: 'new-seeded' },
        prompt: "The provider's endpoint changed: start a new seeded session?",
      });
    case 'context-too-long':
      return note('error', 'This chat is too long for the model. Start a new chat.');
    case 'background-not-allowed':
      return note('error', 'This provider does not run in the background.');
    case 'access-not-supported':
      return note('error', error.reason ?? 'The provider cannot run with this access level. Pick another one, then Continue.', CONTINUE);
    case 'binding-changed':
      return note('warning', "The agent's provider settings changed before this turn ran. Nothing was sent.", CONTINUE);
    case 'instructions-changed':
      return note('warning', "The agent's instructions changed before this turn ran. Nothing was sent.", CONTINUE);
    case 'other':
      return note('error', error.message === '' ? 'The provider failed.' : error.message, CONTINUE);
  }
}

function note(tone: Tone, label: string | null, continueOffer: ContinueOffer | null = null): OutcomeNote {
  return { tone, label, resetsAt: null, continueOffer };
}
