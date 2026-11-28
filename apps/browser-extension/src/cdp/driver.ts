import { BrowserCommandKind, type BrowserCommand, type BrowserDialog, type BrowserEvent, type BrowserResult, type BrowserTabId, type BrowserValue } from '@morrowbot/contracts';
import { ZodError } from 'zod';
import type { BrowserDriver, TabsApi } from '../core/driver.ts';
import { createTakeovers, type TakeoverUi, type Takeovers } from '../core/takeover.ts';
import { fillSecret, isChecked, replaceText, selectOptions, uploadFiles } from './forms.ts';
import { centerOf, click, drag, hover, scroll } from './input.ts';
import { pressKey } from './keys.ts';
import { navigate, screenshot, watchDialogs } from './page.ts';
import { nodeOf, type RefTable } from './refs.ts';
import { BrowserFailure, nextEvent, type CdpSession } from './session.ts';
import { takeSnapshot } from './snapshot.ts';

export interface CdpDriverDeps {
  readonly tabs: TabsApi;
  /** Attaches the DevTools protocol to a tab; throws `BrowserFailure('restricted-page')` where the browser forbids it. */
  readonly attach: (tabId: BrowserTabId) => Promise<CdpSession>;
  readonly takeoverUi: TakeoverUi;
}

/** A `BrowserDriver` for Chromium browsers, through the DevTools protocol. */
export interface CdpDriver extends BrowserDriver {
  readonly takeovers: Takeovers;
  /** The tab closed or the debugger let go of it (the person pressed Cancel on the debugging bar). */
  forget(tabId: BrowserTabId): void;
}

interface TabState {
  readonly session: CdpSession;
  refs: RefTable;
  dialog: BrowserDialog | null;
}

const WHILE_DIALOG = new Set<BrowserCommandKind>(['list-tabs', 'open-tab', 'switch-tab', 'close-tab', 'snapshot', 'handle-dialog', 'start-takeover', 'end-takeover']);
const WHILE_TAKEOVER = new Set<BrowserCommandKind>(['list-tabs', 'open-tab', 'end-takeover']);

export function createCdpDriver({ tabs, attach, takeoverUi }: CdpDriverDeps): CdpDriver {
  const listeners = new Set<(event: BrowserEvent) => void>();
  const emit = (event: BrowserEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const takeovers = createTakeovers(takeoverUi, emit);
  const states = new Map<BrowserTabId, Promise<TabState>>();

  const stateOf = (tabId: BrowserTabId): Promise<TabState> => {
    const known = states.get(tabId);
    if (known !== undefined) return known;
    const opening = (async (): Promise<TabState> => {
      await tabs.get(tabId);
      const session = await attach(tabId);
      const state: TabState = { session, refs: new Map(), dialog: null };
      watchDialogs(session, (dialog) => {
        state.dialog = dialog;
        emit(dialog === null ? { kind: 'dialog-closed', tabId } : { kind: 'dialog-opened', tabId, dialog });
      });
      await session.send('Page.enable', {});
      await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      return state;
    })();
    states.set(tabId, opening);
    opening.catch(() => states.delete(tabId));
    return opening;
  };

  const forget = (tabId: BrowserTabId): void => {
    states.delete(tabId);
  };

  const execute = async (command: BrowserCommand): Promise<BrowserValue> => {
    const done: BrowserValue = { kind: 'done' };
    switch (command.kind) {
      case 'list-tabs':
        return { kind: 'tabs', tabs: await tabs.list() };
      case 'open-tab': {
        const tab = await tabs.createInBackground();
        await navigate((await stateOf(tab.tabId)).session, { kind: 'url', url: command.url });
        return { kind: 'tab', tab: await tabs.get(tab.tabId) };
      }
      case 'switch-tab':
        await tabs.activate(command.tabId, command.focusWindow);
        return { kind: 'tab', tab: await tabs.get(command.tabId) };
      case 'close-tab':
        await tabs.close(command.tabId);
        forget(command.tabId);
        return done;
      case 'start-takeover':
        await tabs.get(command.tabId);
        await takeovers.start(command.tabId, { takeoverId: command.takeoverId, reason: command.reason, message: command.message });
        await tabs.activate(command.tabId, true);
        return done;
      case 'end-takeover':
        await takeovers.end(command.tabId, command.takeoverId);
        return done;
      case 'navigate':
      case 'snapshot':
      case 'click':
      case 'hover':
      case 'type':
      case 'press-key':
      case 'fill-form':
      case 'select-option':
      case 'scroll':
      case 'drag':
      case 'screenshot':
      case 'upload-files':
      case 'handle-dialog':
      case 'fill-secret':
        return onPage(await stateOf(command.tabId), command);
    }
  };

  const onPage = async (state: TabState, command: Extract<BrowserCommand, { tabId: number }>): Promise<BrowserValue> => {
    const { session } = state;
    const node = (ref: string): number => nodeOf(state.refs, ref);
    const done: BrowserValue = { kind: 'done' };
    switch (command.kind) {
      case 'navigate': {
        state.refs = new Map();
        await navigate(session, command.to);
        return { kind: 'tab', tab: await tabs.get(command.tabId) };
      }
      case 'snapshot': {
        const tab = await tabs.get(command.tabId);
        if (state.dialog !== null) return { kind: 'snapshot', tab, tree: '(The page is waiting for the dialog to be answered.)', dialog: state.dialog };
        const snapshot = await takeSnapshot(session);
        state.refs = snapshot.refs;
        return { kind: 'snapshot', tab, tree: snapshot.tree, dialog: null };
      }
      case 'click':
        await untilDialog(session, click(session, await centerOf(session, node(command.ref)), command.button, command.clickCount));
        return done;
      case 'hover':
        await hover(session, await centerOf(session, node(command.ref)));
        return done;
      case 'type':
        await replaceText(session, node(command.ref), command.text);
        if (command.submit) await untilDialog(session, pressKey(session, 'Enter'));
        return done;
      case 'press-key':
        await untilDialog(session, pressKey(session, command.key));
        return done;
      case 'fill-form':
        for (const field of command.fields) {
          const target = node(field.ref);
          switch (field.value.kind) {
            case 'text':
              await replaceText(session, target, field.value.text);
              break;
            case 'checked':
              if ((await isChecked(session, target)) !== field.value.checked) await untilDialog(session, click(session, await centerOf(session, target), 'left', 1));
              break;
            case 'options':
              await selectOptions(session, target, field.value.values);
              break;
          }
        }
        return done;
      case 'select-option':
        await selectOptions(session, node(command.ref), command.values);
        return done;
      case 'scroll':
        await scroll(session, command.to, node);
        return done;
      case 'drag':
        await drag(session, await centerOf(session, node(command.from)), await centerOf(session, node(command.to)));
        return done;
      case 'screenshot':
        return { kind: 'image', mimeType: 'image/png', base64: await screenshot(session, command.area, node) };
      case 'upload-files':
        await uploadFiles(session, node(command.ref), command.paths);
        return done;
      case 'handle-dialog':
        if (state.dialog === null) throw new BrowserFailure('no-dialog', 'No dialog is open on this tab.');
        await session.send('Page.handleJavaScriptDialog', command.action.kind === 'accept' ? { accept: true, ...(command.action.promptText === null ? {} : { promptText: command.action.promptText }) } : { accept: false });
        return done;
      case 'fill-secret':
        await fillSecret(session, node(command.ref), command.origin, command.value);
        return done;
      case 'switch-tab':
      case 'close-tab':
      case 'start-takeover':
      case 'end-takeover':
        throw new BrowserFailure('failed', `${command.kind} is not a page command.`);
    }
  };

  const guard = async (command: BrowserCommand): Promise<void> => {
    if (!('tabId' in command)) return;
    if (takeovers.activeOn(command.tabId) !== undefined && !WHILE_TAKEOVER.has(command.kind)) {
      throw new BrowserFailure('takeover-active', 'The person has this tab. Wait for the takeover to end.');
    }
    const state = states.get(command.tabId);
    if (state !== undefined && (await state).dialog !== null && !WHILE_DIALOG.has(command.kind)) {
      throw new BrowserFailure('dialog-open', 'A dialog is open on this tab. Answer it with handle-dialog first.');
    }
  };

  return {
    commands: BrowserCommandKind.options,
    takeovers,
    forget,
    onEvent: (listener) => {
      listeners.add(listener);
    },
    run: async (command): Promise<BrowserResult> => {
      try {
        await guard(command);
        return { kind: 'ok', value: await execute(command) };
      } catch (error) {
        return failureOf(error);
      }
    },
  };
}

/**
 * Waits for an input action, or only until it opens a JavaScript dialog: Chrome holds the input
 * event's answer until the dialog is closed, so the action finishes in the background.
 */
async function untilDialog(session: CdpSession, action: Promise<void>): Promise<void> {
  action.catch(() => undefined);
  const opened = nextEvent(session, ['Page.javascriptDialogOpening'], () => true, 60_000);
  try {
    await Promise.race([action, opened.promise.then((dialog) => (dialog === null ? action : undefined))]);
  } finally {
    opened.cancel();
  }
}

function failureOf(error: unknown): BrowserResult {
  if (error instanceof BrowserFailure) return { kind: 'error', code: error.code, message: error.message };
  if (error instanceof ZodError) return { kind: 'error', code: 'failed', message: `The browser gave an unexpected answer: ${error.issues[0]?.message ?? ''}` };
  const message = error instanceof Error ? error.message : String(error);
  if (/No node with given id|Could not find node|does not belong to the document|Node is detached/i.test(message)) {
    return { kind: 'error', code: 'stale-ref', message: 'That element is gone from the page. Take a new snapshot.' };
  }
  if (/No tab with id/i.test(message)) return { kind: 'error', code: 'no-such-tab', message };
  return { kind: 'error', code: 'failed', message };
}
