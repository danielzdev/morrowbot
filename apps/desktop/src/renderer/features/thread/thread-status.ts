/** What one chat is doing, as its tab and the chat list show it. */
export type ThreadStatus = 'idle' | 'working' | 'queued' | 'needs-approval' | 'failed';

/** A chat's status dot and its words, so colour is never the only signal. */
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
