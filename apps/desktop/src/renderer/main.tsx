import { render } from 'preact';
import { App } from './app/App.tsx';
import type { MorrowbotBridge } from './bridge.ts';

declare global {
  interface Window {
    readonly morrowbot: MorrowbotBridge;
  }
}

const root = document.getElementById('app');
if (root !== null) render(<App bridge={window.morrowbot} />, root);
