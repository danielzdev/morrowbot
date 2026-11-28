import { Icon } from '../../shared/ui/Icon.tsx';
import { MenuButton } from '../../shared/ui/Menu.tsx';
import { IconButton } from '../../shared/ui/Tooltip.tsx';
import { NameInput } from '../../shared/ui/NameInput.tsx';
import { sectionLabel, type Section } from './sidebar-groups.ts';

export interface SectionHeaderProps {
  readonly section: Section;
  readonly count: number;
  readonly collapsed: boolean;
  readonly renaming: boolean;
  readonly onToggle: () => void;
  readonly onNewFolder: () => void;
  readonly onRename: () => void;
  readonly onRenamed: (name: string | null) => void;
  readonly onDelete: () => void;
}

/** A section title; Agents and folders fold, Agents makes folders, and a folder's ⋯ renames or deletes it. */
export function SectionHeader(props: SectionHeaderProps) {
  const { section } = props;
  const label = sectionLabel(section);
  if (section.kind === 'folder' && props.renaming) {
    return (
      <div class="section-header renaming">
        <NameInput initial={section.folder.name} maxLength={80} label={`Rename folder ${label}`} onDone={props.onRenamed} />
      </div>
    );
  }
  return (
    <div class="section-header">
      <button
        type="button"
        class="section-toggle"
        aria-expanded={!props.collapsed}
        aria-label={`${label}, ${String(props.count)} ${props.count === 1 ? 'agent' : 'agents'}`}
        onClick={props.onToggle}
        onDblClick={() => {
          if (section.kind === 'folder') props.onRename();
        }}
      >
        <span class="section-title">{label}</span>
        <Icon name={props.collapsed ? 'chevron-right' : 'chevron-down'} />
      </button>
      <span class="spacer" />
      {section.kind === 'agents' && <IconButton icon="folder-plus" label="New folder" onClick={props.onNewFolder} />}
      {section.kind === 'folder' && (
        <MenuButton
          icon="more"
          label={`${label} folder actions`}
          items={() => [
            { kind: 'action', id: 'rename', label: 'Rename folder', icon: 'pencil', onSelect: () => { props.onRename(); } },
            { kind: 'separator', id: 'sep' },
            { kind: 'action', id: 'delete', label: 'Delete folder…', icon: 'trash', danger: true, onSelect: props.onDelete },
          ]}
        />
      )}
    </div>
  );
}
