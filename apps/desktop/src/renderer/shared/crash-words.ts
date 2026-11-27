import type { CrashReason } from '@morrowbot/contracts';

/** Why a plugin or provider worker crashed, in words. Pass through `redact` before showing it. */
export function crashDetail(reason: CrashReason): string {
  switch (reason.kind) {
    case 'exit':
      return `Exited (${reason.signal ?? String(reason.code)})`;
    case 'timeout':
      return `Did not answer ${reason.request} in time`;
    case 'protocol':
      return reason.problem;
    case 'init-error':
    case 'spawn-error':
      return reason.message;
  }
}
