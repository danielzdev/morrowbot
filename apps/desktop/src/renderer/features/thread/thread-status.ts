/** What one chat is doing, as the header pill and the chat switcher show it. */
export type ThreadStatus = 'idle' | 'working' | 'queued' | 'needs-approval' | 'failed';

/** The run-state pill's words (spec §3.3); hidden when idle or failed (the failure shows in the chat). */
export function pillText(status: ThreadStatus): string | null {
  switch (status) {
    case 'working':
      return 'Working';
    case 'queued':
      return 'Queued';
    case 'needs-approval':
      return 'Needs approval';
    case 'idle':
    case 'failed':
      return null;
  }
}

/** The switcher's status dot and its words, so colour is never the only signal. */
export function dotOf(status: ThreadStatus): { readonly tone: 'accent' | 'warn' | 'danger' | 'muted'; readonly label: string } | null {
  switch (status) {
    case 'working':
      return { tone: 'accent', label: 'Working' };
    case 'queued':
      return { tone: 'muted', label: 'Queued' };
    case 'needs-approval':
      return { tone: 'warn', label: 'Needs approval' };
    case 'failed':
      return { tone: 'danger', label: 'Last reply failed' };
    case 'idle':
      return null;
  }
}
