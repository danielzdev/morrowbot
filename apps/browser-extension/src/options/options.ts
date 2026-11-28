import { z } from 'zod';
import { loadPairing, newToken, Pairing, savePairing } from '../core/pairing.ts';

const Status = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('connecting'), port: z.number() }),
  z.object({ kind: z.literal('connected'), port: z.number(), browserId: z.string() }),
  z.object({ kind: z.literal('waiting'), port: z.number(), retryInMs: z.number(), reason: z.string() }),
]);

function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`Missing #${id}`);
  return found;
}

const statusNode = element('status', HTMLParagraphElement);
const tokenInput = element('token', HTMLInputElement);
const portInput = element('port', HTMLInputElement);

function showStatus(raw: unknown): void {
  const parsed = Status.safeParse(raw);
  if (!parsed.success) {
    statusNode.textContent = 'Starting…';
    return;
  }
  const status = parsed.data;
  statusNode.classList.toggle('ok', status.kind === 'connected');
  switch (status.kind) {
    case 'connecting':
      statusNode.textContent = `Connecting to Ori Kami on port ${String(status.port)}…`;
      return;
    case 'connected':
      statusNode.textContent = `Connected to Ori Kami as ${status.browserId}.`;
      return;
    case 'waiting':
      statusNode.textContent = `Not connected: ${status.reason} Trying again in ${String(Math.round(status.retryInMs / 1000))} s.`;
      return;
  }
}

async function render(): Promise<void> {
  const pairing = await loadPairing(chrome.storage.local);
  tokenInput.value = pairing.token;
  portInput.value = String(pairing.port);
  showStatus((await chrome.storage.session.get('status')).status);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && 'status' in changes) showStatus(changes.status.newValue);
});

element('copy', HTMLButtonElement).addEventListener('click', () => {
  void navigator.clipboard.writeText(tokenInput.value);
});

element('regenerate', HTMLButtonElement).addEventListener('click', () => {
  void (async () => {
    const pairing = await loadPairing(chrome.storage.local);
    await savePairing(chrome.storage.local, { ...pairing, token: newToken() });
    await render();
  })();
});

element('save-token', HTMLButtonElement).addEventListener('click', () => {
  void (async () => {
    const pairing = await loadPairing(chrome.storage.local);
    const next = Pairing.safeParse({ ...pairing, token: tokenInput.value.trim() });
    if (!next.success) {
      statusNode.textContent = 'A pairing token is 32 or more letters, digits, - or _.';
      return;
    }
    await savePairing(chrome.storage.local, next.data);
    await render();
  })();
});

element('save-port', HTMLButtonElement).addEventListener('click', () => {
  void (async () => {
    const pairing = await loadPairing(chrome.storage.local);
    const next = Pairing.safeParse({ ...pairing, port: Number(portInput.value) });
    if (!next.success) {
      statusNode.textContent = 'Use a port from 1024 to 65535.';
      return;
    }
    await savePairing(chrome.storage.local, next.data);
    await render();
  })();
});

void render();
