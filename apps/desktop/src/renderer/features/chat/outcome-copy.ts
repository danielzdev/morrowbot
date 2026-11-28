import type { FinishReason, GenerationOutcome, ProviderError, ProviderUnavailableReason, SessionChoice, SessionChoiceReason } from '@morrowbot/contracts';
import type { ApprovalEnding } from './thread-model.ts';

export type Tone = 'normal' | 'muted' | 'warning' | 'error';

/** The one thing an outcome note offers. */
export type OutcomeAction =
  | { readonly kind: 'continue'; readonly label: string; readonly sessionChoice: SessionChoice }
  | { readonly kind: 'open-providers'; readonly label: string };

/** The line under a finished reply (spec §4.4). */
export interface OutcomeCopy {
  readonly tone: Tone;
  /** Null for a normal, complete reply. */
  readonly text: string | null;
  /** A reported reset time, shown in the user's own clock. */
  readonly resetsAt: string | null;
  /** Offered only on the chat's latest reply. */
  readonly action: OutcomeAction | null;
}

export interface CopyContext {
  /** The agent's provider name, such as "Claude"; null when unknown. */
  readonly provider: string | null;
  /** Host or provider text made safe to show (spec §9.1), or null when it can't be. */
  readonly safe: (text: string) => string | null;
}

const CONTINUE: OutcomeAction = { kind: 'continue', label: 'Continue', sessionChoice: { kind: 'auto' } };
const NEW_SEEDED: OutcomeAction = { kind: 'continue', label: 'Start a new seeded session', sessionChoice: { kind: 'new-seeded' } };
const OPEN_PROVIDERS: OutcomeAction = { kind: 'open-providers', label: 'Open Providers' };

export const SEED_TRUNCATED = "Older messages weren't sent.";

/** Each reported limit window by its id; others read as a usage limit. */
const WINDOW_NAMES: Readonly<Record<string, string>> = {
  five_hour: '5-hour limit',
  'five-hour': '5-hour limit',
  seven_day: 'weekly limit',
  'seven-day': 'weekly limit',
};

export const STEERED = 'Paused here for your message.';

export function outcomeCopy(outcome: GenerationOutcome, context: CopyContext): OutcomeCopy {
  switch (outcome.kind) {
    case 'completed':
      return finishCopy(outcome.finishReason);
    case 'steered':
      return note('muted', STEERED);
    case 'cancelled':
      return note('muted', 'Stopped.');
    case 'interrupted':
      return note('warning', 'Interrupted: Ori Kami stopped before this reply finished.', CONTINUE);
    case 'failed':
      return errorCopy(outcome.error, context);
  }
}

function finishCopy(reason: FinishReason): OutcomeCopy {
  switch (reason) {
    case 'stop':
      return note('normal', null);
    case 'length':
      return note('warning', 'The reply hit its length limit.');
    case 'refused':
      return note('warning', 'The model declined to answer.');
    case 'turn-limit':
      return note('warning', 'The reply hit its turn limit.');
  }
}

function errorCopy(error: ProviderError, context: CopyContext): OutcomeCopy {
  const name = context.provider ?? 'The provider';
  const owner = context.provider === null ? "The provider's" : `${context.provider}'s`;
  switch (error.kind) {
    case 'rate-limited': {
      const window = (error.windowId === null ? undefined : WINDOW_NAMES[error.windowId]) ?? 'usage limit';
      return { ...note('warning', `${owner} ${window} is reached`, CONTINUE), resetsAt: error.resetsAt };
    }
    case 'signed-out':
      return note('error', `${name} is signed out.`, OPEN_PROVIDERS);
    case 'account-changed':
      return note('error', `${name} is now signed in to a different account.`, OPEN_PROVIDERS);
    case 'not-installed':
      return note('error', `${owner} CLI is not installed.`, OPEN_PROVIDERS);
    case 'outdated':
      return note('error', `${owner} CLI is outdated.`, OPEN_PROVIDERS);
    case 'invalid-model':
      return note('error', `${name} doesn't know this model. Pick another one, then Continue.`, CONTINUE);
    case 'transient':
      return note('warning', `${name} had a temporary problem.`, CONTINUE);
    case 'session-lost':
      return note('error', `${name} lost its saved session.`, CONTINUE);
    case 'route-changed':
      return note('warning', "The provider's endpoint changed.", NEW_SEEDED);
    case 'context-too-long':
      return note('error', 'This chat is too long for the model. Start a new chat.');
    case 'background-not-allowed':
      return note('error', "This provider doesn't run in the background.");
    case 'access-not-supported': {
      const reason = error.reason === null ? null : context.safe(error.reason);
      return note('error', reason ?? `${name} can't run with this access level. Pick another one, then Continue.`, CONTINUE);
    }
    case 'binding-changed':
      return note('warning', "The agent's provider settings changed before this turn ran. Nothing was sent.", CONTINUE);
    case 'instructions-changed':
      return note('warning', "The agent's instructions changed before this turn ran. Nothing was sent.", CONTINUE);
    case 'output-limit':
      return note(
        'warning',
        error.limit === 'events'
          ? 'The reply sent too many updates and was stopped.'
          : "The reply hit Ori Kami's output size limit and was cut off.",
      );
    case 'other': {
      const message = error.message === '' ? null : context.safe(error.message);
      return note('error', message ?? 'The provider failed.', CONTINUE);
    }
  }
}

function note(tone: Tone, text: string | null, action: OutcomeAction | null = null): OutcomeCopy {
  return { tone, text, resetsAt: null, action };
}

/** Why a send was refused, for the banner above the composer. */
export type BannerReason = ProviderUnavailableReason | 'binding-changed';

export interface BannerCopy {
  readonly text: string;
  readonly action: { readonly kind: 'retry' | 'open-providers'; readonly label: string };
}

/** Shown for a refused send whose host text can't be made safe. */
export const PROVIDER_REFUSED = "The provider couldn't take this message.";

/** A refused send (503 or 409). The draft is always kept (spec §4.4). */
export function bannerCopy(reason: BannerReason): BannerCopy {
  switch (reason) {
    case 'rechecking':
      return { text: 'Rechecking the provider… your message is kept.', action: { kind: 'retry', label: 'Try again' } };
    case 'route-info-timeout':
    case 'route-info-failed':
      return { text: "Couldn't verify this provider's route or account.", action: { kind: 'retry', label: 'Try again' } };
    case 'daemon-blocked':
      return { text: 'An earlier provider process is still running.', action: { kind: 'open-providers', label: 'Open details' } };
    case 'binding-changed':
      return { text: 'Settings changed while sending. Your message is still here.', action: { kind: 'retry', label: 'Send again' } };
  }
}

export interface SessionChoiceOption {
  readonly choice: SessionChoice;
  readonly label: string;
  readonly warning: string | null;
}

export interface SessionChoiceCopy {
  readonly prompt: string;
  readonly options: readonly SessionChoiceOption[];
}

const SEEDED: SessionChoiceOption = { choice: { kind: 'new-seeded' }, label: 'Start a new seeded session', warning: null };

/** The host's `session-choice-required`, in v23's words. Continue existing is offered only where it is eligible. */
export function sessionChoiceCopy(reason: SessionChoiceReason): SessionChoiceCopy {
  switch (reason) {
    case 'diverged':
      return {
        prompt: "The provider's saved session did not finish its last turn.",
        options: [{ choice: { kind: 'continue-existing' }, label: 'Continue existing', warning: 'Continuing may repeat actions the provider already took.' }, SEEDED],
      };
    case 'instructions-changed':
      return { prompt: 'Instructions changed: start a new seeded session?', options: [SEEDED] };
    case 'unseeded-history':
      return { prompt: 'This chat has messages the provider has not seen: start a new seeded session?', options: [SEEDED] };
  }
}

export const APPROVAL_FOOTNOTE = 'Unanswered requests are denied after 30 minutes.';

/** How an approval card ends (spec §4.3). Expiry lives here, never in `outcomeCopy`. */
export function approvalEndingCopy(ending: ApprovalEnding): string {
  switch (ending.kind) {
    case 'chosen':
      return `You chose ${ending.label}`;
    case 'expired':
      return 'Expired: denied automatically';
    case 'cleared':
      return 'Request ended';
    case 'late':
      return 'This request already ended.';
  }
}
