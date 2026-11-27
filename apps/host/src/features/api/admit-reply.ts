import type { ApiAdmitResult } from './ports.ts';
import { bindingChanged, failure, notFound, providerUnavailable, sessionChoiceRequired, type Reply } from './reply.ts';

/** The reply for a send or Continue that was not started. Each of these wrote nothing. */
export function refusal(result: Exclude<ApiAdmitResult, { kind: 'started' }>): Reply {
  switch (result.kind) {
    case 'thread_not_found':
      return notFound('Thread');
    case 'busy':
      return failure('conflict', 'This thread is already generating a reply. Stop it first.');
    case 'no_provider':
      return failure('conflict', result.reason);
    case 'not_continuable':
      return failure('conflict', result.reason);
    case 'provider_unavailable':
      return providerUnavailable(result.reason);
    case 'binding_changed':
      return bindingChanged();
    case 'session_choice_required':
      return sessionChoiceRequired(result.reason);
  }
}
