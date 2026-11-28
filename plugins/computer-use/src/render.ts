import type { AppInfo, AxElement, DisplayInfo, Rect, WindowInfo } from './protocol.ts';
import { toLocal, type DesktopSnapshot, type Space, type WindowSnapshot } from './snapshots.ts';

function n(value: number): string {
  return String(Math.round(value));
}

function rect(frame: Rect): string {
  return `${n(frame.x)},${n(frame.y)} ${n(frame.width)}×${n(frame.height)}`;
}

function quoted(value: string | null): string {
  return value === null ? '' : ` "${value.replaceAll('\n', ' ')}"`;
}

export function appLine(app: AppInfo): string {
  const flags = [app.active ? 'active' : null, app.hidden ? 'hidden' : null].filter((flag) => flag !== null);
  return `pid ${String(app.pid)}  ${app.name}${app.bundleId === null ? '' : ` (${app.bundleId})`}${flags.length > 0 ? `  [${flags.join(', ')}]` : ''}`;
}

export function windowLine(window: WindowInfo): string {
  return `window ${String(window.windowId)}  ${window.app} (pid ${String(window.pid)})${quoted(window.title)}  at ${rect(window.frame)}`;
}

export function displayLine(display: DisplayInfo): string {
  return `display ${String(display.displayId)}${display.main ? ' (main)' : ''}  at ${rect(display.frame)} points, ${String(display.pixelWidth)}×${String(display.pixelHeight)} pixels (scale ${String(display.scale)})`;
}

function spaceLine(space: Space, unit: string): string {
  const scale = space.scaleX === 1 && space.scaleY === 1 ? '' : ` (1 unit = ${space.scaleX.toFixed(3)} points)`;
  return `Coordinates for click, drag, scroll and move_cursor: x 0–${n(space.width - 1)}, y 0–${n(space.height - 1)} ${unit}${scale}.`;
}

function elementLine(ref: string, element: AxElement, space: Space): string {
  const name = element.title ?? element.description;
  const value = element.value === null || element.value === name ? '' : ` value=${JSON.stringify(element.value)}`;
  const at = element.frame === null ? '' : ` at ${rect(toLocal(space, element.frame))}`;
  const flags = [element.focused ? 'focused' : null, element.enabled ? null : 'disabled'].filter((flag) => flag !== null);
  const role = element.subrole === null ? element.role : `${element.role}/${element.subrole}`;
  return `${'  '.repeat(element.depth)}[${ref}] ${role}${quoted(name)}${value}${at}${flags.length > 0 ? ` (${flags.join(', ')})` : ''}`;
}

export function windowStateText(snapshot: WindowSnapshot, hasImage: boolean, truncated: boolean): string {
  const lines = [
    `Snapshot ${snapshot.id} of ${windowLine(snapshot.window)}.`,
    spaceLine(snapshot.space, hasImage ? 'in the screenshot' : "in points from the window's top-left"),
    'Act on elements by ref (e.g. click with ref), which re-checks the element first. A newer snapshot of this window makes these refs stale.',
    ...snapshot.elements.map(({ ref, element }) => elementLine(ref, element, snapshot.space)),
  ];
  if (truncated) lines.push('(The tree was cut short: raise maxDepth or maxElements to see more.)');
  return lines.join('\n');
}

export function desktopStateText(snapshot: DesktopSnapshot): string {
  return [`Snapshot ${snapshot.id} of display ${String(snapshot.displayId)} at ${rect(snapshot.frame)} points.`, spaceLine(snapshot.space, 'in the screenshot')].join('\n');
}
