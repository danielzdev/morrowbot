import { z } from 'zod';

/**
 * What the MorrowBot browser plugin asks a browser extension to do, and what comes back. Nothing here
 * is Chromium-specific: a Firefox or Safari extension answers the same commands, and says in its
 * `hello` which ones it supports.
 */

/** A tab id as the browser's `tabs` API reports it. */
export const BrowserTabId = z.number().int().nonnegative();
export type BrowserTabId = z.infer<typeof BrowserTabId>;

/** A compact element reference from the tab's latest snapshot (`e12`). A new snapshot replaces them all. */
export const ElementRef = z.string().regex(/^e\d+$/, 'Use a ref from the latest snapshot, like e12');
export type ElementRef = z.infer<typeof ElementRef>;

export const WebUrl = z.url({ protocol: /^https?$/, error: 'Use an http or https URL' });

export const BrowserTab = z.strictObject({
  tabId: BrowserTabId,
  windowId: z.number().int(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
  status: z.enum(['loading', 'complete']),
});
export type BrowserTab = z.infer<typeof BrowserTab>;

export const BrowserDialog = z.strictObject({
  type: z.enum(['alert', 'confirm', 'prompt', 'beforeunload']),
  message: z.string(),
  defaultPrompt: z.string(),
});
export type BrowserDialog = z.infer<typeof BrowserDialog>;

export const KeyName = z.enum([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
export type KeyName = z.infer<typeof KeyName>;

export const FormFieldValue = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string() }),
  z.strictObject({ kind: z.literal('checked'), checked: z.boolean() }),
  z.strictObject({ kind: z.literal('options'), values: z.array(z.string()).min(1) }),
]);
export type FormFieldValue = z.infer<typeof FormFieldValue>;

export const NavigateTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('url'), url: WebUrl }),
  z.strictObject({ kind: z.literal('back') }),
  z.strictObject({ kind: z.literal('forward') }),
  z.strictObject({ kind: z.literal('reload') }),
]);
export type NavigateTarget = z.infer<typeof NavigateTarget>;

export const ScrollTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('page'), direction: z.enum(['up', 'down', 'left', 'right']), pixels: z.number().int().min(1).max(20_000) }),
  z.strictObject({ kind: z.literal('element'), ref: ElementRef }),
]);
export type ScrollTarget = z.infer<typeof ScrollTarget>;

export const ScreenshotArea = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('viewport') }),
  z.strictObject({ kind: z.literal('full-page') }),
  z.strictObject({ kind: z.literal('element'), ref: ElementRef }),
]);
export type ScreenshotArea = z.infer<typeof ScreenshotArea>;

export const DialogAction = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accept'), promptText: z.string().nullable() }),
  z.strictObject({ kind: z.literal('dismiss') }),
]);
export type DialogAction = z.infer<typeof DialogAction>;

/** Which part of a vault entry a secret is; it decides which fields may take it. */
export const SecretField = z.enum(['username', 'password', 'one-time-code']);
export type SecretField = z.infer<typeof SecretField>;

/** Why the agent hands the tab to the person. */
export const TakeoverReason = z.enum(['login', 'two-factor', 'payment', 'captcha', 'other']);
export type TakeoverReason = z.infer<typeof TakeoverReason>;

const tab = { tabId: BrowserTabId };
const absolutePath = z.string().regex(/^(\/|[A-Za-z]:[\\/])/, 'Use an absolute file path');

export const BrowserCommand = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('list-tabs') }),
  /** Opens in the background: the person's current tab and window keep focus. */
  z.strictObject({ kind: z.literal('open-tab'), url: WebUrl }),
  /** Makes the tab active in its window; raises the window only with `focusWindow`. */
  z.strictObject({ kind: z.literal('switch-tab'), ...tab, focusWindow: z.boolean() }),
  z.strictObject({ kind: z.literal('close-tab'), ...tab }),
  z.strictObject({ kind: z.literal('navigate'), ...tab, to: NavigateTarget }),
  z.strictObject({ kind: z.literal('snapshot'), ...tab }),
  z.strictObject({
    kind: z.literal('click'),
    ...tab,
    ref: ElementRef,
    button: z.enum(['left', 'right', 'middle']),
    clickCount: z.union([z.literal(1), z.literal(2)]),
  }),
  z.strictObject({ kind: z.literal('hover'), ...tab, ref: ElementRef }),
  /** Replaces the field's text; `submit` presses Enter after. */
  z.strictObject({ kind: z.literal('type'), ...tab, ref: ElementRef, text: z.string(), submit: z.boolean() }),
  z.strictObject({ kind: z.literal('press-key'), ...tab, key: KeyName }),
  z.strictObject({
    kind: z.literal('fill-form'),
    ...tab,
    fields: z.array(z.strictObject({ ref: ElementRef, value: FormFieldValue })).min(1),
  }),
  z.strictObject({ kind: z.literal('select-option'), ...tab, ref: ElementRef, values: z.array(z.string()).min(1) }),
  z.strictObject({ kind: z.literal('scroll'), ...tab, to: ScrollTarget }),
  z.strictObject({ kind: z.literal('drag'), ...tab, from: ElementRef, to: ElementRef }),
  z.strictObject({ kind: z.literal('screenshot'), ...tab, area: ScreenshotArea }),
  z.strictObject({ kind: z.literal('upload-files'), ...tab, ref: ElementRef, paths: z.array(absolutePath).min(1) }),
  z.strictObject({ kind: z.literal('handle-dialog'), ...tab, action: DialogAction }),
  /**
   * Types a secret the plugin resolved outside the model (a vault login or one-time code). The
   * extension types it only into an input of the matching type whose own frame is on `origin`, hides
   * that field's value from every later snapshot, and never sends it back.
   */
  z.strictObject({ kind: z.literal('fill-secret'), ...tab, ref: ElementRef, field: SecretField, origin: z.string().min(1), value: z.string().min(1) }),
  /** Shows the person a "your turn" banner on the tab and brings it forward; agent commands on the tab wait until it ends. */
  z.strictObject({
    kind: z.literal('start-takeover'),
    ...tab,
    takeoverId: z.string().min(1),
    reason: TakeoverReason,
    message: z.string().min(1).max(500),
  }),
  z.strictObject({ kind: z.literal('end-takeover'), ...tab, takeoverId: z.string().min(1) }),
]);
export type BrowserCommand = z.infer<typeof BrowserCommand>;
export type BrowserCommandKind = BrowserCommand['kind'];
export const BrowserCommandKind = z.enum(BrowserCommand.options.map((option) => option.shape.kind.value));

export const BrowserValue = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tabs'), tabs: z.array(BrowserTab) }),
  z.strictObject({ kind: z.literal('tab'), tab: BrowserTab }),
  z.strictObject({
    kind: z.literal('snapshot'),
    tab: BrowserTab,
    /** One line per element, indented by depth; elements the agent can act on carry `[ref=eN]`. */
    tree: z.string(),
    dialog: BrowserDialog.nullable(),
  }),
  z.strictObject({ kind: z.literal('image'), mimeType: z.literal('image/png'), base64: z.string().min(1) }),
  z.strictObject({ kind: z.literal('done') }),
]);
export type BrowserValue = z.infer<typeof BrowserValue>;

export const BrowserErrorCode = z.enum([
  'no-such-tab',
  'stale-ref',
  'not-interactable',
  'restricted-page',
  'dialog-open',
  'no-dialog',
  'takeover-active',
  'origin-mismatch',
  'unsupported',
  'timeout',
  'failed',
]);
export type BrowserErrorCode = z.infer<typeof BrowserErrorCode>;

export const BrowserResult = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok'), value: BrowserValue }),
  z.strictObject({ kind: z.literal('error'), code: BrowserErrorCode, message: z.string() }),
]);
export type BrowserResult = z.infer<typeof BrowserResult>;

export const BrowserEvent = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('dialog-opened'), tabId: BrowserTabId, dialog: BrowserDialog }),
  z.strictObject({ kind: z.literal('dialog-closed'), tabId: BrowserTabId }),
  z.strictObject({
    kind: z.literal('takeover-ended'),
    tabId: BrowserTabId,
    takeoverId: z.string().min(1),
    outcome: z.enum(['done', 'cancelled', 'tab-closed']),
  }),
]);
export type BrowserEvent = z.infer<typeof BrowserEvent>;
