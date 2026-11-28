import { Agent, ClaimInviteResponse, InviteResponse, Thread, type MemberAccess } from '@morrowbot/contracts';
import WebSocket from 'ws';
import { ECHO, startChatFixture, type ChatFixture } from './chat-fixture.ts';
import { EventClient, type Reply } from './test-host.ts';

export const URL_FOR_MEMBERS = 'https://studio.example.ts.net';

/** A chat fixture plus the calls a server member makes with its own token. */
export interface MemberKit {
  readonly chat: ChatFixture;
  /** A request with a member's token, or none. */
  as(token: string | undefined, method: string, route: string, body?: unknown): Promise<Reply>;
  /** The owner invites a member and the member claims the invite. */
  join(name: string, access: MemberAccess): Promise<ClaimInviteResponse>;
  /** An agent of the owner's with one chat. */
  named(name: string, binding?: typeof ECHO): Promise<{ readonly agent: Agent; readonly thread: Thread }>;
  /** A member's `/api/events` socket; rejects with the status the host refused it with. */
  events(token: string): Promise<{ readonly socket: WebSocket; readonly client: EventClient }>;
  close(): Promise<void>;
}

export async function startMemberKit(): Promise<MemberKit> {
  const chat = await startChatFixture();
  const as: MemberKit['as'] = async (token, method, route, body) => {
    const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${chat.host.url}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    const parsed: unknown = text === '' ? null : JSON.parse(text);
    return { status: response.status, body: parsed };
  };
  return {
    chat,
    as,
    join: async (name, access) => {
      const invite = InviteResponse.parse((await chat.host.call('POST', '/api/members/invites', { name, access, url: URL_FOR_MEMBERS })).body);
      const claim = { code: invite.code, deviceName: `${name}'s laptop`, platform: 'macos' };
      return ClaimInviteResponse.parse((await as(undefined, 'POST', '/api/members/claim', claim)).body);
    },
    named: async (name, binding = ECHO) => {
      const agent = Agent.parse((await chat.host.call('POST', '/api/agents', { name, provider: binding })).body);
      return { agent, thread: await chat.thread(agent, `${name} chat`) };
    },
    events: (token) => {
      const socket = new WebSocket(`${chat.host.url.replace('http:', 'ws:')}/api/events`, { headers: { authorization: `Bearer ${token}` } });
      return new Promise((resolve, reject) => {
        socket.once('open', () => {
          resolve({ socket, client: new EventClient(socket, (method, path) => as(token, method, path)) });
        });
        socket.once('unexpected-response', (_request, response) => {
          reject(new Error(`refused ${String(response.statusCode)}`));
        });
      });
    },
    close: () => chat.close(),
  };
}
