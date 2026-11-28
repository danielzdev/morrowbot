import { render } from 'preact';
import { Root } from './app/Root.tsx';
import type { MorrowbotBridge } from './bridge.ts';

declare global {
  interface Window {
    readonly morrowbot: MorrowbotBridge;
  }
}

const root = document.getElementById('app');
if (root !== null) render(<Root bridge={window.morrowbot} />, root);
