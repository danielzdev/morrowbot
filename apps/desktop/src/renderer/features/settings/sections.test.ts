import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { expect, it } from 'vitest';
import type { Appearance } from '../../shared/appearance.ts';
import type { ChatPrefs } from '../../shared/chat-prefs.ts';
import { Store } from '../../shared/store.ts';
import { AboutSection } from './AboutSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';
import { ChatSection } from './ChatSection.tsx';
import { GeneralSection } from './GeneralSection.tsx';
import { KeyboardSection } from './KeyboardSection.tsx';
import { INDEX, type SettingsLink, type SettingsSection } from './settings-index.ts';
import { SettingsModal, type SettingsModalProps } from './SettingsModal.tsx';

const APPEARANCE: Appearance = { theme: 'system', reduceMotion: 'system', chatWidth: 'normal', reducedMotion: false };
const PREFS: ChatPrefs = { sendWith: 'enter' };
const INFO = { appVersion: '1.2.3', homeDir: '/Users/tester', userName: 'tester', dataDir: '/Users/tester/.morrowbot' };
const BRIDGE = {
  loginItem: () => Promise.resolve({ kind: 'unsupported' }),
  setOpenAtLogin: () => Promise.resolve({ kind: 'unsupported' }),
  revealPath: () => Promise.resolve(),
};
const ignore = (): void => undefined;
const MODAL: SettingsModalProps = {
  link: 'general',
  onClose: ignore,
  appearance: { state: new Store(APPEARANCE), set: ignore, close: ignore },
  chatPrefs: { state: new Store(PREFS), set: ignore },
  info: INFO,
  bridge: BRIDGE,
  providers: () => null,
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
  chat: () => renderToString(h(ChatSection, { prefs: PREFS, onChange: ignore, platform: 'mac' })),
  keyboard: () => renderToString(h(KeyboardSection, { platform: 'mac', sendWith: 'enter' })),
  providers: () => renderToString(h(SettingsModal, { ...MODAL, link: 'providers' })),
  about: () => renderToString(h(AboutSection, { info: INFO, onRevealData: ignore })),
};

it('renders exactly the rows search knows about, with the same label and description', () => {
  const rendered = Object.values(SECTIONS).flatMap((render) => rowsOf(render()));
  expect(rendered).toEqual(INDEX.map(({ id, label, description }) => `${id} | ${label} | ${description}`));
});

function modal(link: SettingsLink): { readonly breadcrumb: string; readonly current: string | undefined; readonly firstRow: string | undefined; readonly item?: string } {
  let item: string | undefined;
  const html = renderToString(
    h(SettingsModal, {
      ...MODAL,
      link,
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
    about: modal('about'),
    provider: modal('providers/provider-openai'),
  }).toEqual({
    general: { breadcrumb: 'Settings / General', current: 'General', firstRow: 'open-at-login' },
    appearance: { breadcrumb: 'Settings / Appearance', current: 'Appearance', firstRow: 'theme' },
    keyboard: { breadcrumb: 'Settings / Keyboard', current: 'Keyboard', firstRow: 'key-new-chat' },
    about: { breadcrumb: 'Settings / About', current: 'About', firstRow: 'version' },
    provider: { breadcrumb: 'Settings / Providers', current: 'Providers', firstRow: 'providers', item: 'provider-openai' },
  });
});
