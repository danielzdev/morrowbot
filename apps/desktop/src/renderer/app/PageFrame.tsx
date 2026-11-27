import type { ComponentChildren } from 'preact';
import { IconButton } from '../shared/ui/Tooltip.tsx';
import type { Chrome } from './ChatPane.tsx';

/** A page in the main pane that is not a chat: the same 48px draggable top bar, then the page. */
export function PageFrame(props: { readonly title: string; readonly chrome: Chrome; readonly children: ComponentChildren }) {
  return (
    <div class="main">
      <header class="page-header drag">
        {props.chrome.sidebarButton && <IconButton icon="sidebar" label="Show sidebar" shortcut="toggle-sidebar" onClick={props.chrome.showSidebar} />}
        <h1 class="page-title">{props.title}</h1>
      </header>
      <div class="page-scroll">{props.children}</div>
    </div>
  );
}
