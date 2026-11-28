import { describe, expect, it } from 'vitest';
import { chromeMissing } from '../testing/chrome.ts';
import { driverUnderTest, refOf } from '../testing/driver-under-test.ts';

const t = driverUnderTest();

describe.skipIf(chromeMissing)('vault secrets and takeovers on a real page', { timeout: 60_000 }, () => {
  it('fills a secret only into a field on the expected origin', async () => {
    const { tabId, tree: snapshot } = await t.open('form');
    const password = refOf(snapshot, 'textbox "Password"');
    const elsewhere = await t.run({ kind: 'fill-secret', tabId, ref: password, field: 'password', origin: 'https://bank.example', value: 's3cret-value' });
    const filled = await t.run({ kind: 'fill-secret', tabId, ref: password, field: 'password', origin: new URL(t.pages.url('form')).origin, value: 's3cret-value' });
    await t.run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Continue"'), button: 'left', clickCount: 1 });
    const after = await t.tree(tabId);
    expect({ elsewhere: elsewhere.kind === 'error' ? elsewhere.code : elsewhere, filled, leaked: after.includes('s3cret') || JSON.stringify(filled).includes('s3cret'), page: await t.log(tabId) }).toMatchInlineSnapshot(`
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
    const { tabId, tree: snapshot } = await t.open('code');
    const origin = new URL(t.pages.url('code')).origin;
    const passwordIntoEmail = await t.run({ kind: 'fill-secret', tabId, ref: refOf(snapshot, 'textbox "Email"'), field: 'password', origin, value: 's3cret-value' });
    const codeIntoText = await t.run({ kind: 'fill-secret', tabId, ref: refOf(snapshot, 'textbox "Code"'), field: 'one-time-code', origin, value: '424242' });
    const after = await t.tree(tabId);
    const screenshot = await t.run({ kind: 'screenshot', tabId, area: { kind: 'viewport' } });
    const typed = await t.chrome.evaluate(tabId, "document.querySelector('[name=code]').value");
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
    const { tabId, tree: snapshot } = await t.open('form');
    const origin = new URL(t.pages.url('form')).origin;
    await t.run({ kind: 'fill-secret', tabId, ref: refOf(snapshot, 'textbox "Password"'), field: 'password', origin, value: 's3cret-value' });
    const whileMasked = await t.run({ kind: 'screenshot', tabId, area: { kind: 'viewport' } });
    t.driver.detached(tabId);
    await t.chrome.evaluate(tabId, "document.querySelector('[name=password]').type = 'text'");
    const shown = await t.tree(tabId);
    const screenshot = await t.run({ kind: 'screenshot', tabId, area: { kind: 'viewport' } });
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
    const { tabId, tree: snapshot } = await t.open('form');
    t.events.length = 0;
    t.banners.length = 0;
    const started = await t.run({ kind: 'start-takeover', tabId, takeoverId: 't1', reason: 'login', message: 'Sign in, then press I am done.' });
    const refused = await t.run({ kind: 'click', tabId, ref: refOf(snapshot, 'button "Continue"'), button: 'left', clickCount: 1 });
    const listed = await t.run({ kind: 'list-tabs' });
    await t.driver.takeovers.finish('t1', 'done');
    const after = await t.run({ kind: 'snapshot', tabId });
    expect({ started, refused, listed: listed.kind, events: t.events.map((event) => ({ ...event, tabId: event.tabId === tabId ? '<tab>' : event.tabId })), banners: t.banners.map((line) => line.replace(/^(show|hide) \d+/, '$1 <tab>')), after: after.kind }).toMatchInlineSnapshot(`
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
});
