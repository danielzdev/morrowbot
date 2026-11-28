import { z } from '@morrowbot/plugin-sdk';

/** A rectangle in global screen points (top-left origin, as CoreGraphics and Accessibility use). */
export const Rect = z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export type Rect = z.output<typeof Rect>;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const MacPermission = z.enum(['accessibility', 'screen-recording']);
export type MacPermission = z.output<typeof MacPermission>;

export const Permissions = z.strictObject({ accessibility: z.boolean(), screenRecording: z.boolean() });

export const AppInfo = z.strictObject({ pid: z.number().int(), name: z.string(), bundleId: z.string().nullable(), active: z.boolean(), hidden: z.boolean() });
export type AppInfo = z.output<typeof AppInfo>;

export const WindowInfo = z.strictObject({ windowId: z.number().int(), pid: z.number().int(), app: z.string(), title: z.string().nullable(), frame: Rect });
export type WindowInfo = z.output<typeof WindowInfo>;

export const DisplayInfo = z.strictObject({
  displayId: z.number().int(),
  frame: Rect,
  pixelWidth: z.number().int(),
  pixelHeight: z.number().int(),
  scale: z.number(),
  main: z.boolean(),
});
export type DisplayInfo = z.output<typeof DisplayInfo>;

export const Png = z.strictObject({ base64: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive() });
export type Png = z.output<typeof Png>;

export const AxElement = z.strictObject({
  path: z.array(z.number().int().nonnegative()),
  depth: z.number().int().nonnegative(),
  role: z.string(),
  subrole: z.string().nullable(),
  title: z.string().nullable(),
  value: z.string().nullable(),
  description: z.string().nullable(),
  frame: Rect.nullable(),
  enabled: z.boolean(),
  focused: z.boolean(),
  actions: z.array(z.string()),
});
export type AxElement = z.output<typeof AxElement>;

export const WindowState = z.strictObject({ window: WindowInfo, elements: z.array(AxElement), truncated: z.boolean(), image: Png.nullable() });
export type WindowState = z.output<typeof WindowState>;

export const DesktopState = z.strictObject({ display: DisplayInfo, image: Png });
export type DesktopState = z.output<typeof DesktopState>;

export const Launched = z.strictObject({ pid: z.number().int(), name: z.string(), bundleId: z.string().nullable() });
export const Clipboard = z.strictObject({ text: z.string().nullable() });
export const Nothing = z.unknown();

/** What the helper checks still holds before an action lands. */
export type TargetCheck =
  | { readonly kind: 'element'; readonly windowId: number; readonly windowFrame: Rect; readonly path: readonly number[]; readonly role: string; readonly frame: Rect }
  | { readonly kind: 'window'; readonly windowId: number; readonly windowFrame: Rect }
  | { readonly kind: 'display'; readonly displayId: number; readonly frame: Rect };

/** A point in global screen points and the snapshot check it came from. */
export interface HelperTarget {
  readonly point: Point;
  readonly check: TargetCheck;
}

export type Modifier = 'command' | 'shift' | 'option' | 'control' | 'fn';

/** One request to the native helper, written to its stdin as JSON. */
export type HelperRequest =
  | { readonly kind: 'check_permissions'; readonly prompt: boolean }
  | { readonly kind: 'list_apps' }
  | { readonly kind: 'list_windows'; readonly pid: number | null }
  | { readonly kind: 'get_screen_size' }
  | { readonly kind: 'get_window_state'; readonly windowId: number; readonly screenshot: boolean; readonly maxDimension: number; readonly maxDepth: number; readonly maxElements: number }
  | { readonly kind: 'get_desktop_state'; readonly displayId: number | null; readonly maxDimension: number }
  | { readonly kind: 'click'; readonly target: HelperTarget; readonly button: 'left' | 'right'; readonly count: 1 | 2 }
  | { readonly kind: 'move_cursor'; readonly target: HelperTarget }
  | { readonly kind: 'drag'; readonly from: HelperTarget; readonly to: HelperTarget }
  | { readonly kind: 'scroll'; readonly target: HelperTarget; readonly dx: number; readonly dy: number }
  | { readonly kind: 'type_text'; readonly text: string }
  | { readonly kind: 'hotkey'; readonly keyCode: number; readonly modifiers: readonly Modifier[] }
  | { readonly kind: 'bring_to_front'; readonly pid: number; readonly windowId: number | null }
  | { readonly kind: 'launch_app'; readonly bundleId: string | null; readonly name: string | null; readonly activate: boolean }
  | { readonly kind: 'set_window_frame'; readonly windowId: number; readonly frame: Rect }
  | { readonly kind: 'clipboard_read' }
  | { readonly kind: 'clipboard_write'; readonly text: string };

/** The helper's reply line, before its value is checked against what the request expects. */
export const WireReply = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ok'), value: z.unknown() }),
  z.strictObject({ kind: z.literal('unverifiable'), detail: z.string() }),
  z.strictObject({ kind: z.literal('refused'), reason: z.string() }),
  z.strictObject({ kind: z.literal('permission_denied'), missing: z.array(MacPermission).min(1) }),
  z.strictObject({ kind: z.literal('failed'), message: z.string() }),
]);

/** What a helper call comes back with. `unsupported` never comes from the helper itself: it means there is no helper on this OS. */
export type HelperReply<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'unverifiable'; readonly detail: string }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'permission_denied'; readonly missing: readonly MacPermission[] }
  | { readonly kind: 'unsupported'; readonly reason: string }
  | { readonly kind: 'failed'; readonly message: string };

/** Parses the helper's stdout (one JSON line) into a reply whose `ok` value matches `value`. */
export function parseReply<S extends z.ZodType>(lines: readonly string[], value: S): HelperReply<z.output<S>> {
  const last = lines.findLast((line) => line.trim() !== '');
  if (last === undefined) return { kind: 'failed', message: 'The helper printed nothing.' };
  let json: unknown;
  try {
    json = JSON.parse(last);
  } catch {
    return { kind: 'failed', message: 'The helper printed something that is not JSON.' };
  }
  const reply = WireReply.safeParse(json);
  if (!reply.success) return { kind: 'failed', message: `The helper sent an unexpected reply: ${z.prettifyError(reply.error)}` };
  switch (reply.data.kind) {
    case 'ok': {
      const parsed = value.safeParse(reply.data.value);
      if (!parsed.success) return { kind: 'failed', message: `The helper sent an unexpected value: ${z.prettifyError(parsed.error)}` };
      return { kind: 'ok', value: parsed.data };
    }
    case 'unverifiable':
    case 'refused':
    case 'permission_denied':
    case 'failed':
      return reply.data;
  }
}
