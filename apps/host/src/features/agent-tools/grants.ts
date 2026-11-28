import { createHash, randomBytes } from 'node:crypto';

/** Who a turn's tools act as: the turn's agent, in the chat the turn runs in. */
export interface ToolGrant {
  readonly turnId: string;
  readonly agentId: string;
  readonly threadId: string;
}

/** The bearer tokens of running turns. Only their hashes are kept, in memory, until each turn ends. */
export interface ToolGrants {
  /** A new random token standing for `grant` until `revoke(grant.turnId)`. */
  issue(grant: ToolGrant): string;
  revoke(turnId: string): void;
  /** The grant a token stands for; undefined for an unknown token or one whose turn has ended. */
  check(token: string): ToolGrant | undefined;
}

export function createToolGrants(): ToolGrants {
  const byHash = new Map<string, ToolGrant>();
  const hashOf = new Map<string, string>();
  const revoke = (turnId: string): void => {
    const hash = hashOf.get(turnId);
    if (hash === undefined) return;
    hashOf.delete(turnId);
    byHash.delete(hash);
  };
  return {
    issue: (grant) => {
      revoke(grant.turnId);
      const token = randomBytes(32).toString('base64url');
      const hash = digest(token);
      byHash.set(hash, grant);
      hashOf.set(grant.turnId, hash);
      return token;
    },
    revoke,
    check: (token) => byHash.get(digest(token)),
  };
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');
