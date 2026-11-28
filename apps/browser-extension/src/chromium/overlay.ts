import type { TakeoverReason } from '@morrowbot/contracts';
import { z } from 'zod';
import { BrowserFailure } from '../cdp/session.ts';
import type { TakeoverUi } from '../core/takeover.ts';

const TITLES: Readonly<Record<TakeoverReason, string>> = {
  login: 'Please sign in',
  'two-factor': 'Please enter your verification code',
  payment: 'Please review and complete the payment',
  captcha: 'Please solve the check on this page',
  other: 'Your turn',
};

/** What the banner sends the service worker when the person presses Done or Cancel. */
export const TakeoverFinished = z.strictObject({ kind: z.literal('takeover-finished'), takeoverId: z.string().min(1), outcome: z.enum(['done', 'cancelled']) });

const HOST_TAG = 'morrowbot-takeover';

/** Runs inside the page (the extension's isolated world), so it must not use anything from outside. */
function showBanner(tag: string, takeoverId: string, title: string, message: string): void {
  document.querySelector(tag)?.remove();
  const host = document.createElement(tag);
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host { all: initial; }
    .bar { position: fixed; inset: 12px 12px auto 12px; z-index: 2147483647; display: flex; gap: 12px; align-items: center;
      padding: 12px 16px; border-radius: 12px; background: #1d1b2e; color: #fff; font: 14px/1.4 system-ui, sans-serif;
      box-shadow: 0 8px 24px rgba(0,0,0,.35); }
    .text { flex: 1; } .title { font-weight: 600; } .message { opacity: .85; }
    button { font: inherit; border: 0; border-radius: 8px; padding: 6px 14px; cursor: pointer; }
    .done { background: #7c6cff; color: #fff; } .cancel { background: transparent; color: #fff; border: 1px solid #ffffff55; }
  </style>
  <div class="bar" role="alert"><div class="text"><div class="title"></div><div class="message"></div></div>
  <button class="cancel" type="button">Cancel</button><button class="done" type="button">I'm done</button></div>`;
  const titleNode = root.querySelector('.title');
  const messageNode = root.querySelector('.message');
  if (titleNode !== null) titleNode.textContent = `Ori Kami: ${title}`;
  if (messageNode !== null) messageNode.textContent = message;
  const finish = (outcome: 'done' | 'cancelled') => (event: Event) => {
    if (!event.isTrusted) return;
    host.remove();
    void chrome.runtime.sendMessage({ kind: 'takeover-finished', takeoverId, outcome });
  };
  root.querySelector('.done')?.addEventListener('click', finish('done'));
  root.querySelector('.cancel')?.addEventListener('click', finish('cancelled'));
  document.documentElement.append(host);
}

function hideBanner(tag: string): void {
  document.querySelector(tag)?.remove();
}

/** The takeover banner, put on the page with `chrome.scripting` (again after each page load). */
export const chromeOverlay: TakeoverUi = {
  show: async (tabId, view) => {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, func: showBanner, args: [HOST_TAG, view.takeoverId, TITLES[view.reason], view.message] });
    } catch (error) {
      throw new BrowserFailure('restricted-page', `Could not show the takeover banner on this page: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
  hide: async (tabId) => {
    await chrome.scripting.executeScript({ target: { tabId }, func: hideBanner, args: [HOST_TAG] }).catch(() => undefined);
  },
};
