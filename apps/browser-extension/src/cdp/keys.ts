import type { KeyName } from '@morrowbot/contracts';
import type { CdpSession } from './session.ts';

interface KeyDefinition {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly text?: string;
}

const KEYS: Readonly<Record<KeyName, KeyDefinition>> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};

/** Presses and releases one key in whatever has focus. */
export async function pressKey(session: CdpSession, name: KeyName): Promise<void> {
  const { key, code, keyCode, text } = KEYS[name];
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await session.send('Input.dispatchKeyEvent', text === undefined ? { type: 'rawKeyDown', ...base } : { type: 'keyDown', ...base, text, unmodifiedText: text });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
