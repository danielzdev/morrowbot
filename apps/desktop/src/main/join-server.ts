import { ClaimInviteResponse, ClaimPairingResponse, lenient, parseJoinTarget, type DevicePlatform } from '@morrowbot/contracts';
import { z } from 'zod';
import type { ServerRequest } from '../renderer/bridge.ts';
import { checkSender, IpcRefusedError, type IpcSender } from './ipc-proxy.ts';
import type { RemoteChoice, ServerChoice } from './server-choice.ts';

const JoinFields = { link: z.string().max(2000), url: z.string().max(500), code: z.string().max(100) };
export type JoinRequest = Extract<ServerRequest, { kind: 'join' }>;

const ServerRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local') }),
  z.strictObject({ kind: z.literal('join'), ...JoinFields }),
]);

/** Checks an IPC `choose-server` message: only the app page may pick the server. */
export function parseServerRequest(options: { readonly sender: IpcSender; readonly rendererUrl: string; readonly input: unknown }): ServerRequest {
  checkSender(options.sender, options.rendererUrl);
  const parsed = ServerRequestSchema.safeParse(options.input);
  if (!parsed.success) throw new IpcRefusedError('Malformed server choice');
  return parsed.data;
}

export type JoinResult = { readonly kind: 'joined'; readonly choice: RemoteChoice } | { readonly kind: 'failed'; readonly message: string };

const ErrorBody = z.object({ error: z.object({ message: z.string() }) });
const InviteClaimReply = lenient(ClaimInviteResponse);
const PairingClaimReply = lenient(ClaimPairingResponse);

/**
 * Claims an invite (as a server member) or a pairing code (as one of the owner's own devices) on the server named in
 * the request, from main, so the token never reaches the renderer.
 */
export async function joinServer(request: JoinRequest, device: { readonly name: string; readonly platform: DevicePlatform }): Promise<JoinResult> {
  const target = parseJoinTarget(request.link, request.url, request.code);
  if (target.kind === 'invalid') return { kind: 'failed', message: target.reason };
  const path = target.kind === 'invite' ? '/api/members/claim' : '/api/pairing/claim';
  let response: Response;
  try {
    response = await fetch(new URL(path, target.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: target.code, deviceName: device.name, platform: device.platform }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { kind: 'failed', message: `Couldn't reach ${target.url}. Check the address and that this computer can reach the server.` };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorBody.safeParse(body);
    return { kind: 'failed', message: parsed.success ? parsed.data.error.message : `The server answered ${String(response.status)}.` };
  }
  const claimed = (target.kind === 'invite' ? InviteClaimReply : PairingClaimReply).safeParse(body);
  if (!claimed.success) return { kind: 'failed', message: "That address answered, but it isn't an Ori Bot server." };
  return { kind: 'joined', choice: { kind: 'remote', url: target.url, token: claimed.data.token, hostName: claimed.data.hostName } };
}

/** The choice a Welcome or Settings request makes, once any join has claimed its token. */
export async function pickServer(
  request: ServerRequest,
  platform: NodeJS.Platform,
): Promise<{ readonly kind: 'picked'; readonly choice: ServerChoice } | { readonly kind: 'failed'; readonly message: string }> {
  if (request.kind === 'local') return { kind: 'picked', choice: request };
  const joined = await joinServer(request, { name: 'Ori Bot desktop', platform: platformOf(platform) });
  return joined.kind === 'joined' ? { kind: 'picked', choice: joined.choice } : joined;
}

function platformOf(platform: NodeJS.Platform): DevicePlatform {
  if (platform === 'darwin') return 'macos';
  return platform === 'win32' ? 'windows' : 'linux';
}
