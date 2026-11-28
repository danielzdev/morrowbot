import type { PluginPermission } from '@morrowbot/contracts';

/** What each plugin permission lets the plugin do, in the user's words. */
export const PERMISSION_LABELS: Readonly<Record<PluginPermission, string>> = {
  network: 'Use the internet',
  filesystem: 'Read and change files',
  shell: 'Run commands on this computer',
  secrets: 'Use saved passwords and keys',
  accessibility: 'See and control apps on this Mac (Accessibility)',
  'screen-recording': 'Take pictures of the screen (Screen Recording)',
};
