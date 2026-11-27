import type { Agent, Folder } from '@morrowbot/contracts';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.tsx';
import { Menu, type MenuItem } from '../../shared/ui/Menu.tsx';

/** A menu opened from a row: its actions (at the right-click point), which waiting approval to open, or which folder to move the agent to. */
export type RowPopup =
  | { readonly kind: 'actions'; readonly agent: Agent; readonly anchor: HTMLElement; readonly at: { readonly x: number; readonly y: number } | null; readonly items: readonly MenuItem[] }
  | { readonly kind: 'approval'; readonly agentId: string; readonly anchor: HTMLElement; readonly items: readonly MenuItem[] }
  | { readonly kind: 'move'; readonly agent: Agent; readonly anchor: HTMLElement };

function popupLabel(popup: RowPopup): string {
  switch (popup.kind) {
    case 'actions':
      return `${popup.agent.name} actions`;
    case 'approval':
      return 'Choose an approval';
    case 'move':
      return `Move ${popup.agent.name} to`;
  }
}

/** The folder choices for an agent: every other folder, out of its folder, or a new folder made for it. */
export function moveItems(agent: Agent, folders: readonly Folder[], onMove: (folderId: string | null) => void, onNewFolder: () => void): readonly MenuItem[] {
  return [
    ...folders
      .filter(({ id }) => id !== agent.folderId)
      .map((folder): MenuItem => ({ kind: 'action', id: folder.id, label: folder.name, icon: 'folder', onSelect: () => { onMove(folder.id); } })),
    ...(agent.folderId === null ? [] : [{ kind: 'action', id: 'none', label: 'Remove from folder', icon: 'close', onSelect: () => { onMove(null); } } satisfies MenuItem]),
    ...(folders.length === 0 && agent.folderId === null ? [] : [{ kind: 'separator', id: 'sep' } satisfies MenuItem]),
    { kind: 'action', id: 'new', label: 'New folder…', icon: 'folder-plus', onSelect: onNewFolder },
  ];
}

export function SidebarPopups(props: {
  readonly popup: RowPopup | null;
  readonly folders: readonly Folder[];
  readonly deletingAgent: Agent | null;
  readonly deletingFolder: Folder | null;
  readonly onClosePopup: () => void;
  readonly onMove: (agentId: string, folderId: string | null) => void;
  readonly onNewFolderFor: (agentId: string) => void;
  readonly onCancelDeleteAgent: () => void;
  readonly onDeleteAgent: (id: string) => void;
  readonly onCancelDeleteFolder: () => void;
  readonly onDeleteFolder: () => void;
}) {
  const { popup, deletingAgent, deletingFolder } = props;
  return (
    <>
      {popup !== null && (
        <Menu
          anchor={{ current: popup.anchor }}
          {...(popup.kind === 'actions' && popup.at !== null ? { at: popup.at, side: 'bottom' } : { side: 'right' })}
          label={popupLabel(popup)}
          align="start"
          onClose={props.onClosePopup}
          items={
            popup.kind === 'move'
              ? moveItems(popup.agent, props.folders, (folderId) => { props.onMove(popup.agent.id, folderId); }, () => { props.onNewFolderFor(popup.agent.id); })
              : popup.items
          }
        />
      )}
      {deletingAgent !== null && (
        <ConfirmDialog
          title={`Delete ${deletingAgent.name}?`}
          body={<p>Its chats are deleted. The workspace folder stays on disk.</p>}
          confirmLabel="Delete agent"
          tone="danger"
          typeToConfirm={deletingAgent.name}
          onCancel={props.onCancelDeleteAgent}
          onConfirm={() => {
            props.onDeleteAgent(deletingAgent.id);
          }}
        />
      )}
      {deletingFolder !== null && (
        <ConfirmDialog
          title={`Delete the folder “${deletingFolder.name}”?`}
          body={<p>Its agents stay, under Agents.</p>}
          confirmLabel="Delete folder"
          tone="danger"
          onCancel={props.onCancelDeleteFolder}
          onConfirm={props.onDeleteFolder}
        />
      )}
    </>
  );
}
