import type { ChatSettings } from '@morrowbot/contracts';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import type { Appearance } from '../../shared/appearance.ts';
import type { ChatPrefs } from '../../shared/chat-prefs.ts';
import type { ChatSettingsModel } from '../../shared/chat-settings.ts';
import { Store, type Loadable } from '../../shared/store.ts';
import type { UpdateStatus } from '../../bridge.ts';
import type { UpdatesModel } from '../../shared/updates.ts';
import { AboutSection } from './AboutSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { ChatSection } from './ChatSection.tsx';
import { DevicesSection } from './DevicesSection.tsx';
import { GeneralSection } from './GeneralSection.tsx';
import { KeyboardSection } from './KeyboardSection.tsx';
import type { MembersPort } from './members.ts';
import { MembersSection } from './MembersSection.tsx';
import type { PairingPort } from './pairing.ts';
import { ServerSection } from './ServerSection.tsx';
import { hiddenSections, INDEX, type SettingsLink, type SettingsSection } from './settings-index.ts';
import { SettingsModal, type SettingsModalProps } from './SettingsModal.tsx';

const APPEARANCE: Appearance = { theme: 'system', reduceMotion: 'system', chatWidth: 'normal', reducedMotion: false };
const PREFS: ChatPrefs = { sendWith: 'enter', notify: 'on' };
const INFO = { appVersion: '1.2.3', homeDir: '/Users/tester', userName: 'tester', dataDir: '/Users/tester/.morrowbot' };
const BRIDGE = {
  loginItem: () => Promise.resolve({ kind: 'unsupported' }),
  setOpenAtLogin: () => Promise.resolve({ kind: 'unsupported' }),
  revealPath: () => Promise.resolve(),
  resetPlan: () => Promise.resolve({ token: 'test', options: [] }),
  runReset: () => Promise.resolve({ kind: 'refused', reason: 'test' }),
};
const ignore = (): void => undefined;
const PAIRING: PairingPort = {
  createPairingCode: () => Promise.resolve({ kind: 'failed', status: 409, error: { kind: 'conflict', message: 'No address' } }),
  listDevices: () => Promise.resolve({ kind: 'ok', value: { devices: [] } }),
  unpairDevice: () => Promise.resolve({ kind: 'ok', value: null }),
};
const MEMBERS: MembersPort = {
  createInvite: () => Promise.resolve({ kind: 'failed', status: 409, error: { kind: 'conflict', message: 'No address' } }),
  listMembers: () => Promise.resolve({ kind: 'ok', value: { members: [] } }),
  revokeMember: () => Promise.resolve({ kind: 'ok', value: null }),
  listAgents: () => Promise.resolve({ kind: 'ok', value: { agents: [], folders: [], lastMessages: [] } }),
  copy: () => Promise.resolve(),
};
const CHAT_SETTINGS: ChatSettingsModel = {
  state: new Store<Loadable<ChatSettings>>({ kind: 'loaded', value: { emojiReplies: 'per_agent' } }),
  load: () => Promise.resolve(),
  setEmojiReplies: () => Promise.resolve(null),
};
const UPDATES: UpdatesModel = { status: new Store<UpdateStatus>({ kind: 'up-to-date' }), check: ignore, restart: ignore, close: ignore };
const MODAL: SettingsModalProps = {
  link: 'general',
  onClose: ignore,
  appearance: { state: new Store(APPEARANCE), set: ignore, close: ignore },
  chatPrefs: { state: new Store(PREFS), set: ignore },
  chatSettings: CHAT_SETTINGS,
  info: INFO,
  updates: UPDATES,
  bridge: BRIDGE,
  providers: () => null,
  usage: h('p', { class: 'usage-stub' }, 'usage'),
  pairing: PAIRING,
  members: MEMBERS,
  server: { kind: 'local' },
  chooseServer: () => Promise.resolve(null),
  hidden: new Set(),
};

const decode = (text: string): string => text.replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>');

/** Each rendered row as `id | label | description`, read back from the HTML. */
function rowsOf(html: string): string[] {
  const row = /data-setting="([^"]+)"><div class="setting-text"><div class="setting-label">([^<]*)<\/div><div class="setting-description">([^<]*)<\/div>/g;
  return [...html.matchAll(row)].map(([, id = '', label = '', description = '']) => `${id} | ${decode(label)} | ${decode(description)}`);
}

const SECTIONS: Readonly<Record<SettingsSection, () => string>> = {
  general: () => renderToString(h(GeneralSection, { bridge: BRIDGE })),
  appearance: () => renderToString(h(AppearanceSection, { appearance: APPEARANCE, onChange: ignore })),
  chat: () => renderToString(h(ChatSection, { prefs: PREFS, onChange: ignore, platform: 'mac', chatSettings: CHAT_SETTINGS })),
  keyboard: () => renderToString(h(KeyboardSection, { platform: 'mac', sendWith: 'enter' })),
  providers: () => renderToString(h(SettingsModal, { ...MODAL, link: 'providers' })),
  usage: () => '',
  server: () => renderToString(h(ServerSection, { server: { kind: 'local' }, onChoose: () => Promise.resolve(null) })),
  members: () => renderToString(h(MembersSection, { port: MEMBERS })),
  devices: () => renderToString(h(DevicesSection, { pairing: PAIRING })),
  about: () => renderToString(h(AboutSection, { info: INFO, update: { kind: 'up-to-date' }, onRevealData: ignore, onCheckForUpdates: ignore, onRestartToUpdate: ignore, reset: BRIDGE })),
};

it('renders exactly the rows search knows about, with the same label and description', () => {
  const rendered = Object.values(SECTIONS).flatMap((render) => rowsOf(render()));
  expect(rendered).toEqual(INDEX.map(({ id, label, description }) => `${id} | ${label} | ${description}`));
});

function modal(link: SettingsLink, hidden: ReadonlySet<SettingsSection> = new Set()): { readonly breadcrumb: string; readonly current: string | undefined; readonly firstRow: string | undefined; readonly item?: string } {
  let item: string | undefined;
  const html = renderToString(
    h(SettingsModal, {
      ...MODAL,
      link,
      hidden,
      providers: (slot) => {
        item = slot.initial ?? 'none';
        return null;
      },
    }),
  );
  return {
    breadcrumb: [...html.matchAll(/<div class="breadcrumb">(.*?)<\/div>/g)].map(([, parts = '']) => parts.replaceAll(/<[^>]+>/g, ' ').trim().replaceAll(/\s+/g, ' / '))[0] ?? '',
    current: /aria-current="page"[^>]*>.*?<span>([^<]+)<\/span>/.exec(html)?.[1],
    firstRow: rowsOf(html)[0]?.split(' | ')[0],
    ...(item === undefined ? {} : { item }),
  };
}

it('opens each deep link at its section, with the nav and breadcrumb pointing there', () => {
  expect({
    general: modal('general'),
    appearance: modal('appearance/reduce-motion'),
    keyboard: modal('keyboard/key-escape'),
    usage: modal('usage'),
    devices: modal('devices/paired-devices'),
    about: modal('about'),
    provider: modal('providers/provider-openai'),
    devicesOnJoinedServer: modal('devices', hiddenSections('remote', 'co-owner')),
    usageAsScopedMember: modal('usage', hiddenSections('remote', 'scoped')),
  }).toEqual({
    general: { breadcrumb: 'Settings / General', current: 'General', firstRow: 'open-at-login' },
    appearance: { breadcrumb: 'Settings / Appearance', current: 'Appearance', firstRow: 'theme' },
    keyboard: { breadcrumb: 'Settings / Keyboard', current: 'Keyboard', firstRow: 'key-palette' },
    usage: { breadcrumb: 'Settings / Usage', current: 'Usage', firstRow: undefined },
    devices: { breadcrumb: 'Settings / Devices', current: 'Devices', firstRow: 'pair-phone' },
    about: { breadcrumb: 'Settings / About', current: 'About', firstRow: 'version' },
    provider: { breadcrumb: 'Settings / Providers', current: 'Providers', firstRow: 'providers', item: 'provider-openai' },
    devicesOnJoinedServer: { breadcrumb: 'Settings / General', current: 'General', firstRow: 'open-at-login' },
    usageAsScopedMember: { breadcrumb: 'Settings / General', current: 'General', firstRow: 'open-at-login' },
  });
});
