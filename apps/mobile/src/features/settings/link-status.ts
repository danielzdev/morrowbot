import type { HostReachability, LinkStatus } from '../../lib/host-connection.ts';

export type Tone = 'ok' | 'warn' | 'danger' | 'muted';

export interface StatusLabel {
  readonly tone: Tone;
  readonly label: string;
}

/** The active host's live link, in words. `now` is epoch ms. */
export function describeLink(status: LinkStatus, now: number): StatusLabel {
  switch (status.kind) {
    case 'online':
      return { tone: 'ok', label: 'Connected' };
    case 'connecting':
      return { tone: 'warn', label: status.attempt === 0 ? 'Connecting…' : 'Reconnecting…' };
    case 'reconnecting': {
      const seconds = Math.max(1, Math.ceil((status.retryAt - now) / 1000));
      return { tone: 'warn', label: `Offline · retrying in ${String(seconds)} s` };
    }
    case 'revoked':
      return { tone: 'danger', label: 'Unpaired on the desktop' };
  }
}

/** Another saved host: unknown until its probe answers. */
export function describeReachability(reachability: HostReachability | null): StatusLabel {
  if (reachability === null) return { tone: 'muted', label: 'Checking…' };
  switch (reachability.kind) {
    case 'online':
      return { tone: 'ok', label: 'Available' };
    case 'offline':
      return { tone: 'muted', label: 'Offline' };
    case 'revoked':
      return { tone: 'danger', label: 'Unpaired on the desktop' };
  }
}
