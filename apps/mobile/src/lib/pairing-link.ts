import { HostUrl, PairingCode } from '@morrowbot/contracts';

/** Where to pair and with which code, from a scanned QR, a `morrowbot://pair` link, or typed fields. */
export interface PairingTarget {
  readonly url: HostUrl;
  readonly code: PairingCode;
}

export type PairingInput =
  | { readonly kind: 'ok'; readonly target: PairingTarget }
  | { readonly kind: 'invalid'; readonly problem: string };

const LINK = /^morrowbot:\/\/pair\/?\?([^#]*)$/i;

/** Reads the QR payload the desktop shows: `morrowbot://pair?url=<host url>&code=<6 digits>`. */
export function parsePairingLink(text: string): PairingInput {
  const query = LINK.exec(text.trim())?.[1];
  const params = query === undefined ? null : parseQuery(query);
  if (params === null) return { kind: 'invalid', problem: 'This is not a MorrowBot pairing code.' };
  return parsePairingFields(params.get('url') ?? '', params.get('code') ?? '');
}

/** Checks a typed host address and code. A bare `host:port` is read as `http://host:port`. */
export function parsePairingFields(url: string, code: string): PairingInput {
  const typed = url.trim();
  const parsedUrl = HostUrl.safeParse(/^[a-z][a-z\d+.-]*:\/\//i.test(typed) ? typed : `http://${typed}`);
  if (!parsedUrl.success) {
    return { kind: 'invalid', problem: 'Enter the host address, such as http://100.64.0.1:47800.' };
  }
  const parsedCode = PairingCode.safeParse(code.replace(/\s/g, ''));
  if (!parsedCode.success) return { kind: 'invalid', problem: 'Enter the 6-digit code shown on the desktop.' };
  return { kind: 'ok', target: { url: parsedUrl.data, code: parsedCode.data } };
}

/** React Native's `URLSearchParams` is partial, so the query is split here; null when it is not valid percent-encoding. */
function parseQuery(query: string): ReadonlyMap<string, string> | null {
  const params = new Map<string, string>();
  try {
    for (const pair of query.split('&')) {
      if (pair === '') continue;
      const [key = '', ...rest] = pair.split('=');
      const name = decodeURIComponent(key.replace(/\+/g, ' '));
      if (!params.has(name)) params.set(name, decodeURIComponent(rest.join('=').replace(/\+/g, ' ')));
    }
  } catch {
    return null;
  }
  return params;
}
