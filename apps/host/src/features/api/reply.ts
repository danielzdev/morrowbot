import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Agent, AgentInstructionsView, ApiError, ConnectorScope, ProviderUnavailableReason, SessionChoiceReason } from '@morrowbot/contracts';
import type { z } from 'zod';
import { sendFile, type FileReply } from './file-reply.ts';

export type Reply =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'empty'; readonly status: number; readonly headers?: Readonly<Record<string, string>> }
  | FileReply;

type ErrorKind = Exclude<
  ApiError['error']['kind'],
  'provider-unavailable' | 'binding-changed' | 'session-choice-required' | 'instructions-conflict' | 'scope-conflict' | 'agent-conflict'
>;

const STATUS: Record<ErrorKind, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  internal: 500,
};

export function json(status: number, body: unknown): Reply {
  return { kind: 'json', status, body };
}

export function noContent(): Reply {
  return { kind: 'empty', status: 204 };
}

export function failure(kind: ErrorKind, message: string, status = STATUS[kind]): Reply {
  const body: ApiError = { error: { kind, message } };
  return json(status, body);
}

/** Nothing was written: the provider cannot take a send right now (503). */
export function providerUnavailable(reason: ProviderUnavailableReason): Reply {
  const messages: Record<ProviderUnavailableReason, string> = {
    'route-info-timeout': 'The provider took too long to say which account it uses. Try again.',
    'route-info-failed': 'The provider could not say which account it uses. Try again.',
    'daemon-blocked': "A provider process from before is still running. Release it on the Plugins page first.",
    rechecking: 'The provider is being rechecked. Try again in a moment.',
  };
  const body: ApiError = { error: { kind: 'provider-unavailable', reason, message: messages[reason] } };
  return json(503, body);
}

export function bindingChanged(): Reply {
  const body: ApiError = {
    error: { kind: 'binding-changed', message: "The agent's provider settings changed while sending. Nothing was sent; try again." },
  };
  return json(409, body);
}

export function sessionChoiceRequired(reason: SessionChoiceReason): Reply {
  const messages: Record<SessionChoiceReason, string> = {
    diverged: 'The last turn in the saved session did not finish. Continue it anyway, or start a new session seeded from this thread.',
    'instructions-changed': "The agent's instructions changed since the session started. Start a new session seeded from this thread.",
    'unseeded-history': 'This thread has history the provider has not seen. Start a new session seeded from this thread.',
  };
  const body: ApiError = { error: { kind: 'session-choice-required', reason, message: messages[reason] } };
  return json(409, body);
}

/** `SOUL.md` was left as it is: it exists already, or replacing it is not available yet (409). */
export function instructionsConflict(reason: 'occupied' | 'replace-unavailable', current: AgentInstructionsView): Reply {
  const messages: Record<typeof reason, string> = {
    occupied: 'This folder already has a SOUL.md, so MorrowBot kept it and wrote nothing.',
    'replace-unavailable': "Editing SOUL.md in place isn't available yet. Nothing was changed.",
  };
  const body: ApiError = { error: { kind: 'instructions-conflict', reason, current, message: messages[reason] } };
  return json(409, body);
}

/** A connector's scope changed since the caller read it; nothing was written (409). */
export function scopeConflict(current: ConnectorScope): Reply {
  const body: ApiError = { error: { kind: 'scope-conflict', current, message: 'Changed elsewhere.' } };
  return json(409, body);
}

/** An agent record changed since the caller read it; nothing was written (409). */
export function agentConflict(current: Agent): Reply {
  const body: ApiError = { error: { kind: 'agent-conflict', current, message: 'Changed elsewhere.' } };
  return json(409, body);
}

export function notFound(what: string): Reply {
  return failure('not_found', `${what} not found`);
}

export function invalid(error: z.ZodError): Reply {
  return failure(
    'invalid_request',
    error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`).join('; '),
  );
}

export function send(response: ServerResponse, reply: Reply): void {
  switch (reply.kind) {
    case 'json':
      response.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
      break;
    case 'empty':
      response.writeHead(reply.status, reply.headers).end();
      break;
    case 'file':
      sendFile(response, reply);
      break;
  }
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export type Body = { readonly kind: 'ok'; readonly value: unknown } | { readonly kind: 'rejected'; readonly reply: Reply };

/** Reads a JSON request body. Only `application/json` is accepted, so browsers must preflight (and fail). */
export async function readJson(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Body> {
  const type = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    return { kind: 'rejected', reply: failure('invalid_request', 'Send the body as application/json', 415) };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      if (!(chunk instanceof Buffer)) continue;
      size += chunk.length;
      if (size > maxBytes) {
        return { kind: 'rejected', reply: failure('invalid_request', 'Request body is too large', 413) };
      }
      chunks.push(chunk);
    }
  } catch {
    return { kind: 'rejected', reply: failure('invalid_request', 'The request body was cut off') };
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return { kind: 'ok', value };
  } catch {
    return { kind: 'rejected', reply: failure('invalid_request', 'Request body is not valid JSON') };
  }
}
