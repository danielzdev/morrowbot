import { z } from 'zod';
import { pressKey } from './keys.ts';
import { BrowserFailure, call, type CdpSession } from './session.ts';

const Resolved = z.object({ object: z.object({ objectId: z.string() }) });
const Returned = z.object({
  result: z.object({ value: z.unknown().optional() }),
  exceptionDetails: z.object({ text: z.string() }).optional(),
});

/** Runs `fn` in the page with the node as `this` and returns its JSON result. */
async function onNode(session: CdpSession, backendNodeId: number, fn: string, args: readonly unknown[] = []): Promise<unknown> {
  const { object } = await call(session, 'DOM.resolveNode', { backendNodeId }, Resolved);
  try {
    const answer = await call(
      session,
      'Runtime.callFunctionOn',
      { objectId: object.objectId, functionDeclaration: fn, arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true },
      Returned,
    );
    if (answer.exceptionDetails !== undefined) throw new BrowserFailure('failed', `The page threw: ${answer.exceptionDetails.text}`);
    return answer.result.value;
  } finally {
    await session.send('Runtime.releaseObject', { objectId: object.objectId });
  }
}

const SELECT_TEXT = `function () {
  if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) { this.focus(); this.select(); return 'field'; }
  if (this instanceof HTMLElement && this.isContentEditable) {
    this.focus();
    const range = document.createRange(); range.selectNodeContents(this);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return 'editable';
  }
  return 'other';
}`;

/** Replaces the field's text the way typing would, so the page's input handlers run. */
export async function replaceText(session: CdpSession, backendNodeId: number, text: string): Promise<void> {
  await session.send('DOM.focus', { backendNodeId });
  const kind = z.enum(['field', 'editable', 'other']).parse(await onNode(session, backendNodeId, SELECT_TEXT));
  if (kind === 'other') throw new BrowserFailure('not-interactable', 'The element is not a text field.');
  if (text === '') await pressKey(session, 'Delete');
  else await session.send('Input.insertText', { text });
}

export async function isChecked(session: CdpSession, backendNodeId: number): Promise<boolean> {
  const value = await onNode(session, backendNodeId, `function () {
    if (this instanceof HTMLInputElement && (this.type === 'checkbox' || this.type === 'radio')) return this.checked;
    const state = this.getAttribute('aria-checked');
    return state === null ? null : state === 'true';
  }`);
  const checked = z.boolean().nullable().parse(value);
  if (checked === null) throw new BrowserFailure('not-interactable', 'The element is not a checkbox or radio button.');
  return checked;
}

const PICK_OPTIONS = `function (wanted) {
  if (!(this instanceof HTMLSelectElement)) return { kind: 'not-select' };
  const matches = [...this.options].filter((option) => wanted.includes(option.value) || wanted.includes(option.label));
  const chosen = this.multiple ? matches : matches.slice(0, 1);
  if (chosen.length === 0) return { kind: 'picked', picked: [] };
  for (const option of this.options) option.selected = chosen.includes(option);
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { kind: 'picked', picked: chosen.map((option) => option.label) };
}`;

const Picked = z.discriminatedUnion('kind', [z.object({ kind: z.literal('not-select') }), z.object({ kind: z.literal('picked'), picked: z.array(z.string()) })]);

export async function selectOptions(session: CdpSession, backendNodeId: number, values: readonly string[]): Promise<void> {
  const answer = Picked.parse(await onNode(session, backendNodeId, PICK_OPTIONS, [values]));
  switch (answer.kind) {
    case 'not-select':
      throw new BrowserFailure('not-interactable', 'The element is not a <select>; click it and pick from the list instead.');
    case 'picked':
      if (answer.picked.length === 0) throw new BrowserFailure('failed', `No option matches ${values.join(', ')}.`);
      return;
  }
}

/**
 * Types a secret only when the field's own document is on `origin`, so a page that navigated
 * away, or a field inside a frame from elsewhere, never receives it.
 */
export async function fillSecret(session: CdpSession, backendNodeId: number, origin: string, value: string): Promise<void> {
  const actual = z.string().parse(await onNode(session, backendNodeId, 'function () { return this.ownerDocument.location.origin; }'));
  if (actual !== origin) throw new BrowserFailure('origin-mismatch', `The field belongs to ${actual}, not ${origin}; nothing was filled.`);
  await replaceText(session, backendNodeId, value);
}

export async function uploadFiles(session: CdpSession, backendNodeId: number, paths: readonly string[]): Promise<void> {
  const isFileInput = z.boolean().parse(await onNode(session, backendNodeId, "function () { return this instanceof HTMLInputElement && this.type === 'file'; }"));
  if (!isFileInput) throw new BrowserFailure('not-interactable', 'The element is not a file input.');
  await session.send('DOM.setFileInputFiles', { backendNodeId, files: paths });
}
