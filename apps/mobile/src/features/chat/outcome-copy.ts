import type { AssistantMessage, ProviderError } from '@morrowbot/contracts';

/** The note under a reply that did not finish, and the button that runs it again. */
export interface OutcomeNote {
  readonly text: string;
  readonly tone: 'muted' | 'warn' | 'danger';
  /** Null when there is nothing to run again, e.g. the user stopped it. */
  readonly action: 'Continue' | 'Retry' | null;
}

function errorText(error: ProviderError): string {
  switch (error.kind) {
    case 'rate-limited':
      return 'The provider is rate limiting this account.';
    case 'signed-out':
    case 'account-changed':
      return 'The provider is signed out on the host.';
    case 'not-installed':
    case 'outdated':
      return 'The provider’s CLI needs attention on the host.';
    case 'invalid-model':
      return 'That model is not available any more.';
    case 'transient':
    case 'route-changed':
    case 'session-lost':
      return 'The provider had a hiccup.';
    case 'context-too-long':
      return 'This chat is too long for the model.';
    case 'background-not-allowed':
    case 'access-not-supported':
      return 'The provider refused this kind of turn.';
    case 'binding-changed':
    case 'instructions-changed':
      return 'The agent’s settings changed during this reply.';
    case 'other':
      return 'The reply failed.';
  }
}

export function outcomeNote(message: AssistantMessage): OutcomeNote | null {
  const { outcome } = message;
  switch (outcome.kind) {
    case 'completed':
      return outcome.finishReason === 'stop' ? null : { text: 'The reply was cut short.', tone: 'muted', action: null };
    case 'cancelled':
      return { text: 'Stopped.', tone: 'muted', action: null };
    case 'interrupted':
      return { text: 'Interrupted before it finished.', tone: 'warn', action: 'Continue' };
    case 'failed':
      return { text: errorText(outcome.error), tone: 'danger', action: 'Retry' };
  }
}
