import { createHash, randomBytes } from 'node:crypto';

/** Who a turn's tools act as: the turn's agent, in the chat the turn runs in. */
export interface ToolGrant {
  readonly turnId: string;
  readonly agentId: string;
  readonly threadId: string;
}

/** A checked grant, paired with a signal that aborts when the turn closes or is cancelled. */
export interface ActiveGrant extends ToolGrant {
  readonly signal: AbortSignal;
}

interface StoredGrant {
  readonly grant: ToolGrant;
  readonly controller: AbortController;
}

/** The bearer tokens of running turns. Only their hashes are kept, in memory, until each turn ends. */
export interface ToolGrants {
  /** A new random token standing for `grant` until `revoke(grant.turnId)`. */
  issue(grant: ToolGrant): string;
  revoke(turnId: string): void;
  /** Revokes every active turn token and aborts all in-flight tool calls. */
  revokeAll(): void;
  /** The grant a token stands for; undefined for an unknown token or one whose turn has ended. */
  check(token: string): ActiveGrant | undefined;
}

export function createToolGrants(): ToolGrants {
  const byHash = new Map<string, StoredGrant>();
  const hashOf = new Map<string, string>();
  const revoke = (turnId: string): void => {
    const hash = hashOf.get(turnId);
    if (hash === undefined) return;
    hashOf.delete(turnId);
    const stored = byHash.get(hash);
    byHash.delete(hash);
    stored?.controller.abort();
  };
  return {
    issue: (grant) => {
      revoke(grant.turnId);
      const token = randomBytes(32).toString('base64url');
      const hash = digest(token);
      byHash.set(hash, { grant, controller: new AbortController() });
      hashOf.set(grant.turnId, hash);
      return token;
    },
    revoke,
    revokeAll: () => {
      for (const turnId of [...hashOf.keys()]) revoke(turnId);
    },
    check: (token) => {
      const stored = byHash.get(digest(token));
      return stored === undefined ? undefined : { ...stored.grant, signal: stored.controller.signal };
    },
  };
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');
