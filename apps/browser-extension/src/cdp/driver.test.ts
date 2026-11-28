import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserResult } from '@morrowbot/contracts';
import { chromeMissing } from '../testing/chrome.ts';
import { driverUnderTest, refOf } from '../testing/driver-under-test.ts';

const t = driverUnderTest();

/** Width and height from a PNG's header. */
function pngSize(result: BrowserResult): string {
  if (result.kind !== 'ok' || result.value.kind !== 'image') return JSON.stringify(result);
  const bytes = Buffer.from(result.value.base64, 'base64');
  return `${String(bytes.readUInt32BE(16))}x${String(bytes.readUInt32BE(20))}`;
}

describe.skipIf(chromeMissing)('the Chromium driver on a real page', { timeout: 60_000 }, () => {
  it('reads a form as a compact tree with refs', async () => {
    const { tree: snapshot } = await t.open('form');
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
    const { tabId, tree: before } = await t.open('form');
    const fill = await t.run({
      kind: 'fill-form',
      tabId,
      fields: [
        { ref: refOf(before, 'textbox "Email"'), value: { kind: 'text', text: 'ada@example.com' } },
        { ref: refOf(before, 'checkbox "Remember me"'), value: { kind: 'checked', checked: true } },
        { ref: refOf(before, 'combobox "Plan"'), value: { kind: 'options', values: ['Pro'] } },
      ],
    });
    const typed = await t.run({ kind: 'type', tabId, ref: refOf(before, 'textbox "Password"'), text: 'hunter2', submit: true });
    const after = await t.tree(tabId);
    expect({ fill: fill.kind, typed: typed.kind, after, leaked: /hunter2|•/.test(after), page: await t.log(tabId) }).toMatchInlineSnapshot(`
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
    const { tabId, tree: snapshot } = await t.open('form');
    const folder = await mkdtemp(path.join(tmpdir(), 'oribot-upload-'));
    const file = path.join(folder, 'avatar.txt');
    await writeFile(file, 'hello');
    const notFileInput = await t.run({ kind: 'upload-files', tabId, ref: refOf(snapshot, 'textbox "Email"'), paths: [file] });
    const uploaded = await t.run({ kind: 'upload-files', tabId, ref: refOf(snapshot, 'button "Avatar"'), paths: [file] });
    expect({ notFileInput, uploaded: uploaded.kind, page: await t.log(tabId) }).toMatchInlineSnapshot(`
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
    const { tabId, tree: snapshot } = await t.open('dialog');
    t.events.length = 0;
    const clicked = await t.run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Delete"'), button: 'left', clickCount: 1 });
    const held = await t.run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Delete"'), button: 'left', clickCount: 1 });
    const during = await t.run({ kind: 'snapshot', tabId });
    const answered = await t.run({ kind: 'handle-dialog', tabId, action: { kind: 'accept', promptText: null } });
    const again = await t.run({ kind: 'handle-dialog', tabId, action: { kind: 'dismiss' } });
    expect({
      clicked: clicked.kind,
      held,
      during: during.kind === 'ok' && during.value.kind === 'snapshot' ? { dialog: during.value.dialog, tree: during.value.tree } : during,
      answered: answered.kind,
      again,
      events: t.events.map((event) => event.kind),
      page: await t.log(tabId),
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
    const { tabId, tree: snapshot } = await t.open('leave');
    await t.run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Edit"'), button: 'left', clickCount: 1 });
    const started = Date.now();
    const navigated = await t.run({ kind: 'navigate', tabId, to: { kind: 'url', url: t.pages.url('form') } });
    const returnedWithinSeconds = Math.ceil((Date.now() - started) / 1000);
    const during = await t.run({ kind: 'snapshot', tabId });
    const accepted = await t.run({ kind: 'handle-dialog', tabId, action: { kind: 'accept', promptText: null } });
    await vi.waitFor(async () => {
      expect((await t.chrome.tabs.get(tabId)).title).toBe('Sign in');
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
    const { tabId, tree: snapshot } = await t.open('pointer');
    const t0 = Date.now();
    await t.run({ kind: 'hover', tabId, ref: refOf(snapshot, 'button "Hover me"') });
    const hovered = await t.log(tabId);
    const tNear = Date.now();
    const nearDrag = await t.run({ kind: 'drag', tabId, from: refOf(snapshot, 'button "Card"'), to: refOf(snapshot, 'region "Bin"') });
    const nearMs = Date.now() - tNear;
    const dropped = await t.log(tabId);
    const tScroll = Date.now();
    await t.run({ kind: 'scroll', tabId, to: { kind: 'page', direction: 'down', pixels: 500 } });
    const scrollMs = Date.now() - tScroll;
    const byPage = await t.chrome.evaluate(tabId, 'Math.round(window.scrollY)');
    await t.run({ kind: 'scroll', tabId, to: { kind: 'element', ref: refOf(snapshot, 'button "Bottom"') } });
    const toElement = await t.chrome.evaluate(tabId, 'window.scrollY > 2000');
    await t.chrome.evaluate(tabId, "scrollTo(0, 0); document.getElementById('log').textContent = ''");
    const tFar = Date.now();
    const farDrag = await t.run({ kind: 'drag', tabId, from: refOf(snapshot, 'button "Card"'), to: refOf(snapshot, 'region "Far bin"') });
    const farMs = Date.now() - tFar;
    const farDropped = await t.log(tabId);
    expect(nearDrag).toEqual({ kind: 'ok', value: { kind: 'done' } });
    expect(farDrag).toEqual({ kind: 'ok', value: { kind: 'done' } });
    if (farDropped === '') {
      const diag = await t.chrome.evaluate(
        tabId,
        "({ vis: document.visibilityState, scrollY: window.scrollY, viewport: { w: innerWidth, h: innerHeight }, card: document.getElementById('card')?.getBoundingClientRect().toJSON(), far: document.getElementById('far')?.getBoundingClientRect().toJSON() })",
      );
      throw new Error(`farDropped was empty after drag: ${JSON.stringify({ totalMs: Date.now() - t0, nearMs, scrollMs, farMs, farDrag, diag })}`);
    }
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
    const { tabId, tree: snapshot } = await t.open('pointer');
    const viewport = pngSize(await t.run({ kind: 'screenshot', tabId, area: { kind: 'viewport' } }));
    const fullPage = pngSize(await t.run({ kind: 'screenshot', tabId, area: { kind: 'full-page' } }));
    const element = pngSize(await t.run({ kind: 'screenshot', tabId, area: { kind: 'element', ref: refOf(snapshot, 'button "Card"') } }));
    const windowSize = await t.chrome.evaluate(tabId, '`${innerWidth}x${innerHeight}`');
    expect({ viewportIsTheWindow: viewport === windowSize, fullPageIsTaller: Number(fullPage.split('x')[1]) > 3000, element }).toMatchInlineSnapshot(`
      {
        "element": "122x62",
        "fullPageIsTaller": true,
        "viewportIsTheWindow": true,
      }
    `);
  });

  it('says when a ref is stale or a tab is gone', async () => {
    const { tabId, tree: snapshot } = await t.open('form');
    await t.run({ kind: 'navigate', tabId, to: { kind: 'reload' } });
    const stale = await t.run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Continue"'), button: 'left', clickCount: 1 });
    await t.tree(tabId);
    await t.chrome.evaluate(tabId, 'document.body.innerHTML = ""');
    const removed = await t.run({ kind: 'click', tabId, ref: 'e1', button: 'left', clickCount: 1 });
    const gone = await t.run({ kind: 'snapshot', tabId: 99_999 });
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
