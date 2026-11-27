import type { ComponentChildren } from 'preact';

export type IconName =
  | 'plus'
  | 'more'
  | 'chevron-down'
  | 'chevron-right'
  | 'close'
  | 'check'
  | 'settings'
  | 'plugins'
  | 'sidebar'
  | 'trash'
  | 'pencil'
  | 'copy'
  | 'folder'
  | 'folder-plus'
  | 'chat'
  | 'search'
  | 'info'
  | 'warning'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'keyboard'
  | 'palette'
  | 'provider';

const dot = (cx: number, cy: number, r = 1.1) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

/** Each icon on a 16px grid, drawn with a 1.5px stroke in `currentColor`. */
const SHAPES: Readonly<Record<IconName, ComponentChildren>> = {
  plus: <path d="M8 3v10M3 8h10" />,
  more: (
    <>
      {dot(3.5, 8)}
      {dot(8, 8)}
      {dot(12.5, 8)}
    </>
  ),
  'chevron-down': <path d="M4.5 6.25 8 9.75l3.5-3.5" />,
  'chevron-right': <path d="M6.25 4.5 9.75 8l-3.5 3.5" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  settings: (
    <>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
      {dot(5.5, 4.5, 1.7)}
      {dot(10.5, 8, 1.7)}
      {dot(7, 11.5, 1.7)}
    </>
  ),
  plugins: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <circle cx="11.25" cy="11.25" r="2.25" />
    </>
  ),
  provider: (
    <>
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
      <path d="M6.5 2v2M9.5 2v2M6.5 12v2M9.5 12v2M2 6.5h2M2 9.5h2M12 6.5h2M12 9.5h2" />
    </>
  ),
  sidebar: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M6.5 3v10" />
    </>
  ),
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />,
  pencil: <path d="M10.5 2.5l3 3L6 13H3v-3z" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
    </>
  ),
  folder: <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3L8 4.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />,
  'folder-plus': <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3L8 4.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5zM8 6.75v4M6 8.75h4" />,
  chat: <path d="M3 3h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5V11" />
      {dot(8, 5.2, 0.9)}
    </>
  ),
  warning: (
    <>
      <path d="M8 2.5 14 13.5H2z" />
      <path d="M8 6.5v3" />
      {dot(8, 11.4, 0.9)}
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
    </>
  ),
  moon: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />,
  monitor: (
    <>
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
      <path d="M5.5 14h5M8 11v3" />
    </>
  ),
  keyboard: (
    <>
      <rect x="1.75" y="3.75" width="12.5" height="8.5" rx="1.5" />
      {dot(4.5, 6.5, 0.7)}
      {dot(6.85, 6.5, 0.7)}
      {dot(9.15, 6.5, 0.7)}
      {dot(11.5, 6.5, 0.7)}
      <path d="M5 9.5h6" />
    </>
  ),
  palette: (
    <>
      <path d="M8 2a6 6 0 1 0 0 12c.9 0 1.4-.6 1.4-1.3 0-.8-.6-1.1-.6-1.8 0-.7.5-1.2 1.3-1.2H11.5A2.5 2.5 0 0 0 14 7.2C14 4.3 11.3 2 8 2z" />
      {dot(5, 7.5, 0.9)}
      {dot(7, 5, 0.9)}
      {dot(10.2, 5.4, 0.9)}
    </>
  ),
};

/** A decorative icon; the control around it carries the accessible name. */
export function Icon(props: { readonly name: IconName; readonly size?: number }) {
  const size = props.size ?? 16;
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[props.name]}
    </svg>
  );
}
