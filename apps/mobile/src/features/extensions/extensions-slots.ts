import type { DetailSlot, TabSlot } from '../../lib/workspace.ts';
import { ExtensionBody, ExtensionTitle } from './ExtensionDetail.tsx';
import { ExtensionsList } from './ExtensionsList.tsx';

export const extensionsTab: TabSlot = { Sidebar: ExtensionsList, actions: [], onSearch: null };

export const extensionDetail: DetailSlot<'extension'> = {
  tabs: ['extensions'],
  Title: ExtensionTitle,
  Body: ExtensionBody,
  actions: () => [],
};
