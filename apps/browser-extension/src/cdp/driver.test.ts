import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BrowserCommand, BrowserEvent, BrowserResult } from '@morrowbot/contracts';
import { chromeMissing, launchChrome, type ChromeUnderTest } from '../testing/chrome.ts';
import { servePages } from '../testing/pages.ts';
import { createCdpDriver, type CdpDriver } from './driver.ts';

let chrome: ChromeUnderTest;
let pages: Awaited<ReturnType<typeof servePages>>;
let driver: CdpDriver;
const events: BrowserEvent[] = [];
const banners: string[] = [];

beforeAll(async () => {
  chrome = await launchChrome();
  pages = await servePages();
  driver = createCdpDriver({
    tabs: chrome.tabs,
    attach: chrome.attach,
    takeoverUi: {
      show: (tabId, view) => {
        banners.push(`show ${String(tabId)} ${view.reason}: ${view.message}`);
        return Promise.resolve();
      },
      hide: (tabId) => {
        banners.push(`hide ${String(tabId)}`);
        return Promise.resolve();
      },
    },
  });
  driver.onEvent((event) => events.push(event));
}, 30_000);

afterAll(async () => {
  await chrome.close();
  await pages.close();
});

const run = (command: BrowserCommand): Promise<BrowserResult> => driver.run(command);

/** Opens `page` in a new tab and returns the tab id and a snapshot's tree. */
async function open(page: string): Promise<{ readonly tabId: number; readonly tree: string }> {
  const opened = await run({ kind: 'open-tab', url: pages.url(page) });
  if (opened.kind !== 'ok' || opened.value.kind !== 'tab') throw new Error(JSON.stringify(opened));
  return { tabId: opened.value.tab.tabId, tree: await tree(opened.value.tab.tabId) };
}

async function tree(tabId: number): Promise<string> {
  const snapshot = await run({ kind: 'snapshot', tabId });
  if (snapshot.kind !== 'ok' || snapshot.value.kind !== 'snapshot') throw new Error(JSON.stringify(snapshot));
  return snapshot.value.tree;
}

/** The ref on the snapshot line that mentions `label`. */
function refOf(snapshotTree: string, label: string): string {
  const line = snapshotTree.split('\n').find((candidate) => candidate.includes(label) && candidate.includes('[ref='));
  const ref = /\[ref=(e\d+)\]/.exec(line ?? '')?.[1];
  if (ref === undefined) throw new Error(`No ref for ${label} in:\n${snapshotTree}`);
  return ref;
}

const log = async (tabId: number): Promise<unknown> => chrome.evaluate(tabId, "document.getElementById('log').textContent");

/** Width and height from a PNG's header. */
function pngSize(result: BrowserResult): string {
  if (result.kind !== 'ok' || result.value.kind !== 'image') return JSON.stringify(result);
  const bytes = Buffer.from(result.value.base64, 'base64');
  return `${String(bytes.readUInt32BE(16))}x${String(bytes.readUInt32BE(20))}`;
}

describe.skipIf(chromeMissing)('the Chromium driver on a real page', () => {
  it('reads a form as a compact tree with refs', async () => {
    const { tree: snapshot } = await open('form');
    expect(snapshot).toMatchInlineSnapshot(`
      "- heading "Sign in" [ref=e1] [level=1]
      - form [ref=e2]
        - textbox "Email" [ref=e3]
        - textbox "Password" [ref=e4] value=""
        - checkbox "Remember me" [ref=e5]
        - combobox "Plan" [ref=e6] value="Free"
          - option "Free" [ref=e7] [selected]
          - option "Pro" [ref=e8]
        - button "Avatar" [ref=e9]
        - button "Continue" [ref=e10]
      - status [ref=e11]"
    `);
  });

  it('fills a form, keeps the password out of the snapshot, and submits', async () => {
    const { tabId, tree: before } = await open('form');
    const fill = await run({
      kind: 'fill-form',
      tabId,
      fields: [
        { ref: refOf(before, 'textbox "Email"'), value: { kind: 'text', text: 'ada@example.com' } },
        { ref: refOf(before, 'checkbox "Remember me"'), value: { kind: 'checked', checked: true } },
        { ref: refOf(before, 'combobox "Plan"'), value: { kind: 'options', values: ['Pro'] } },
      ],
    });
    const typed = await run({ kind: 'type', tabId, ref: refOf(before, 'textbox "Password"'), text: 'hunter2', submit: true });
    const after = await tree(tabId);
    expect({ fill: fill.kind, typed: typed.kind, after, leaked: /hunter2|•/.test(after), page: await log(tabId) }).toMatchInlineSnapshot(`
      {
        "after": "- heading "Sign in" [ref=e1] [level=1]
      - form [ref=e2]
        - textbox "Email" [ref=e3] value="ada@example.com"
        - textbox "Password" [ref=e4] [focused] value=<hidden>
        - checkbox "Remember me" [ref=e5] [checked]
        - combobox "Plan" [ref=e6] value="Pro"
          - option "Free" [ref=e7]
          - option "Pro" [ref=e8] [selected]
        - button "Avatar" [ref=e9]
        - button "Continue" [ref=e10]
      - status [ref=e11]
        - text "submitted ada@example.com remember=true plan=pro password-length=7"",
        "fill": "ok",
        "leaked": false,
        "page": "submitted ada@example.com remember=true plan=pro password-length=7",
        "typed": "ok",
      }
    `);
  });

  it('puts a file into a file input', async () => {
    const { tabId, tree: snapshot } = await open('form');
    const folder = await mkdtemp(path.join(tmpdir(), 'morrowbot-upload-'));
    const file = path.join(folder, 'avatar.txt');
    await writeFile(file, 'hello');
    const notFileInput = await run({ kind: 'upload-files', tabId, ref: refOf(snapshot, 'textbox "Email"'), paths: [file] });
    const uploaded = await run({ kind: 'upload-files', tabId, ref: refOf(snapshot, 'button "Avatar"'), paths: [file] });
    expect({ notFileInput, uploaded: uploaded.kind, page: await log(tabId) }).toMatchInlineSnapshot(`
      {
        "notFileInput": {
          "code": "not-interactable",
          "kind": "error",
          "message": "The element is not a file input.",
        },
        "page": "file avatar.txt",
        "uploaded": "ok",
      }
    `);
  });

  it('reports a dialog, holds other commands until it is answered, then answers it', async () => {
    const { tabId, tree: snapshot } = await open('dialog');
    events.length = 0;
    const clicked = await run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Delete"'), button: 'left', clickCount: 1 });
    const held = await run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Delete"'), button: 'left', clickCount: 1 });
    const during = await run({ kind: 'snapshot', tabId });
    const answered = await run({ kind: 'handle-dialog', tabId, action: { kind: 'accept', promptText: null } });
    const again = await run({ kind: 'handle-dialog', tabId, action: { kind: 'dismiss' } });
    expect({
      clicked: clicked.kind,
      held,
      during: during.kind === 'ok' && during.value.kind === 'snapshot' ? { dialog: during.value.dialog, tree: during.value.tree } : during,
      answered: answered.kind,
      again,
      events: events.map((event) => event.kind),
      page: await log(tabId),
    }).toMatchInlineSnapshot(`
      {
        "again": {
          "code": "no-dialog",
          "kind": "error",
          "message": "No dialog is open on this tab.",
        },
        "answered": "ok",
        "clicked": "ok",
        "during": {
          "dialog": {
            "defaultPrompt": "",
            "message": "Delete everything?",
            "type": "confirm",
          },
          "tree": "(The page is waiting for the dialog to be answered.)",
        },
        "events": [
          "dialog-opened",
          "dialog-closed",
        ],
        "held": {
          "code": "dialog-open",
          "kind": "error",
          "message": "A dialog is open on this tab. Answer it with handle-dialog first.",
        },
        "page": "confirmed=true",
      }
    `);
  });

  it('returns from a navigation that opens a leave-page dialog, and goes on once it is accepted', async () => {
    const { tabId, tree: snapshot } = await open('leave');
    await run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Edit"'), button: 'left', clickCount: 1 });
    const started = Date.now();
    const navigated = await run({ kind: 'navigate', tabId, to: { kind: 'url', url: pages.url('form') } });
    const returnedWithinSeconds = Math.ceil((Date.now() - started) / 1000);
    const during = await run({ kind: 'snapshot', tabId });
    const accepted = await run({ kind: 'handle-dialog', tabId, action: { kind: 'accept', promptText: null } });
    await vi.waitFor(async () => {
      expect((await chrome.tabs.get(tabId)).title).toBe('Sign in');
    });
    expect({ navigated: navigated.kind, returnedWithinSeconds, dialog: during.kind === 'ok' && during.value.kind === 'snapshot' ? during.value.dialog : during, accepted: accepted.kind }).toMatchInlineSnapshot(`
      {
        "accepted": "ok",
        "dialog": {
          "defaultPrompt": "",
          "message": "",
          "type": "beforeunload",
        },
        "navigated": "ok",
        "returnedWithinSeconds": 1,
      }
    `);
  });

  it('hovers, drags with HTML drag and drop, and scrolls', async () => {
    const { tabId, tree: snapshot } = await open('pointer');
    await run({ kind: 'hover', tabId, ref: refOf(snapshot, 'button "Hover me"') });
    const hovered = await log(tabId);
    await run({ kind: 'drag', tabId, from: refOf(snapshot, 'button "Card"'), to: refOf(snapshot, 'region "Bin"') });
    const dropped = await log(tabId);
    await run({ kind: 'scroll', tabId, to: { kind: 'page', direction: 'down', pixels: 500 } });
    await vi.waitFor(async () => {
      expect(await chrome.evaluate(tabId, 'Math.round(window.scrollY)')).toBe(500);
    }).catch(() => undefined);
    const byPage = await chrome.evaluate(tabId, 'Math.round(window.scrollY)');
    await run({ kind: 'scroll', tabId, to: { kind: 'element', ref: refOf(snapshot, 'button "Bottom"') } });
    const toElement = await chrome.evaluate(tabId, 'window.scrollY > 2000');
    await chrome.evaluate(tabId, "scrollTo(0, 0); document.getElementById('log').textContent = ''");
    await run({ kind: 'drag', tabId, from: refOf(snapshot, 'button "Card"'), to: refOf(snapshot, 'region "Far bin"') });
    const farDropped = await log(tabId);
    expect({ hovered, dropped, byPage, toElement, farDropped }).toMatchInlineSnapshot(`
      {
        "byPage": 500,
        "dropped": "dropped card",
        "farDropped": "dropped far card",
        "hovered": "hovered",
        "toElement": true,
      }
    `);
  });

  it('takes viewport, full-page and element screenshots', async () => {
    const { tabId, tree: snapshot } = await open('pointer');
    const viewport = pngSize(await run({ kind: 'screenshot', tabId, area: { kind: 'viewport' } }));
    const fullPage = pngSize(await run({ kind: 'screenshot', tabId, area: { kind: 'full-page' } }));
    const element = pngSize(await run({ kind: 'screenshot', tabId, area: { kind: 'element', ref: refOf(snapshot, 'button "Card"') } }));
    const windowSize = await chrome.evaluate(tabId, '`${innerWidth}x${innerHeight}`');
    expect({ viewportIsTheWindow: viewport === windowSize, fullPageIsTaller: Number(fullPage.split('x')[1]) > 3000, element }).toMatchInlineSnapshot(`
      {
        "element": "122x62",
        "fullPageIsTaller": true,
        "viewportIsTheWindow": true,
      }
    `);
  });

  it('fills a secret only into a field on the expected origin', async () => {
    const { tabId, tree: snapshot } = await open('form');
    const password = refOf(snapshot, 'textbox "Password"');
    const elsewhere = await run({ kind: 'fill-secret', tabId, ref: password, field: 'password', origin: 'https://bank.example', value: 's3cret-value' });
    const filled = await run({ kind: 'fill-secret', tabId, ref: password, field: 'password', origin: new URL(pages.url('form')).origin, value: 's3cret-value' });
    await run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Continue"'), button: 'left', clickCount: 1 });
    const after = await tree(tabId);
    expect({ elsewhere: elsewhere.kind === 'error' ? elsewhere.code : elsewhere, filled, leaked: after.includes('s3cret') || JSON.stringify(filled).includes('s3cret'), page: await log(tabId) }).toMatchInlineSnapshot(`
      {
        "elsewhere": "origin-mismatch",
        "filled": {
          "kind": "ok",
          "value": {
            "kind": "done",
          },
        },
        "leaked": false,
        "page": "submitted  remember=false plan=free password-length=12",
      }
    `);
  });

  it('types a secret only into a matching input, then keeps it out of snapshots and screenshots', async () => {
    const { tabId, tree: snapshot } = await open('code');
    const origin = new URL(pages.url('code')).origin;
    const passwordIntoEmail = await run({ kind: 'fill-secret', tabId, ref: refOf(snapshot, 'textbox "Email"'), field: 'password', origin, value: 's3cret-value' });
    const codeIntoText = await run({ kind: 'fill-secret', tabId, ref: refOf(snapshot, 'textbox "Code"'), field: 'one-time-code', origin, value: '424242' });
    const after = await tree(tabId);
    const screenshot = await run({ kind: 'screenshot', tabId, area: { kind: 'viewport' } });
    const typed = await chrome.evaluate(tabId, "document.querySelector('[name=code]').value");
    expect({ passwordIntoEmail, codeIntoText: codeIntoText.kind, typed, after, leaked: /s3cret|424242/.test(after), screenshot }).toMatchInlineSnapshot(`
      {
        "after": "- textbox "Email" [ref=e1]
      - textbox "Code" [ref=e2] [focused] value=<hidden>",
        "codeIntoText": "ok",
        "leaked": false,
        "passwordIntoEmail": {
          "code": "not-interactable",
          "kind": "error",
          "message": "A password goes only into an input of type password; nothing was filled.",
        },
        "screenshot": {
          "code": "failed",
          "kind": "error",
          "message": "A value from the vault is visible on the page; take the screenshot after the page moves on.",
        },
        "typed": "424242",
      }
    `);
  });

  it('keeps a vault password hidden after the debugger lets go, and once the page shows it', async () => {
    const { tabId, tree: snapshot } = await open('form');
    const origin = new URL(pages.url('form')).origin;
    await run({ kind: 'fill-secret', tabId, ref: refOf(snapshot, 'textbox "Password"'), field: 'password', origin, value: 's3cret-value' });
    const whileMasked = await run({ kind: 'screenshot', tabId, area: { kind: 'viewport' } });
    driver.detached(tabId);
    await chrome.evaluate(tabId, "document.querySelector('[name=password]').type = 'text'");
    const shown = await tree(tabId);
    const screenshot = await run({ kind: 'screenshot', tabId, area: { kind: 'viewport' } });
    expect({ whileMasked: whileMasked.kind, passwordLine: shown.split('\n').find((line) => line.includes('"Password"')), leaked: shown.includes('s3cret'), screenshot }).toMatchInlineSnapshot(`
      {
        "leaked": false,
        "passwordLine": "  - textbox "Password" [ref=e4] [focused] value=<hidden>",
        "screenshot": {
          "code": "failed",
          "kind": "error",
          "message": "A value from the vault is visible on the page; take the screenshot after the page moves on.",
        },
        "whileMasked": "ok",
      }
    `);
  });

  it('hands a tab to the person and refuses agent commands until they finish', async () => {
    const { tabId, tree: snapshot } = await open('form');
    events.length = 0;
    banners.length = 0;
    const started = await run({ kind: 'start-takeover', tabId, takeoverId: 't1', reason: 'login', message: 'Sign in, then press I am done.' });
    const refused = await run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Continue"'), button: 'left', clickCount: 1 });
    const listed = await run({ kind: 'list-tabs' });
    await driver.takeovers.finish('t1', 'done');
    const after = await run({ kind: 'snapshot', tabId });
    expect({ started, refused, listed: listed.kind, events: events.map((event) => ({ ...event, tabId: event.tabId === tabId ? '<tab>' : event.tabId })), banners: banners.map((line) => line.replace(/^(show|hide) \d+/, '$1 <tab>')), after: after.kind }).toMatchInlineSnapshot(`
      {
        "after": "ok",
        "banners": [
          "show <tab> login: Sign in, then press I am done.",
          "hide <tab>",
        ],
        "events": [
          {
            "kind": "takeover-ended",
            "outcome": "done",
            "tabId": "<tab>",
            "takeoverId": "t1",
          },
        ],
        "listed": "ok",
        "refused": {
          "code": "takeover-active",
          "kind": "error",
          "message": "The person has this tab. Wait for the takeover to end.",
        },
        "started": {
          "kind": "ok",
          "value": {
            "kind": "done",
          },
        },
      }
    `);
  });

  it('says when a ref is stale or a tab is gone', async () => {
    const { tabId, tree: snapshot } = await open('form');
    await run({ kind: 'navigate', tabId, to: { kind: 'reload' } });
    const stale = await run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Continue"'), button: 'left', clickCount: 1 });
    await tree(tabId);
    await chrome.evaluate(tabId, 'document.body.innerHTML = ""');
    const removed = await run({ kind: 'click', tabId, ref: 'e1', button: 'left', clickCount: 1 });
    const gone = await run({ kind: 'snapshot', tabId: 99_999 });
    expect({ stale, removed, gone }).toMatchInlineSnapshot(`
      {
        "gone": {
          "code": "no-such-tab",
          "kind": "error",
          "message": "No tab 99999.",
        },
        "removed": {
          "code": "stale-ref",
          "kind": "error",
          "message": "That element is gone from the page. Take a new snapshot.",
        },
        "stale": {
          "code": "stale-ref",
          "kind": "error",
          "message": "e10 is not in this tab's latest snapshot. Take a new snapshot.",
        },
      }
    `);
  });
});
