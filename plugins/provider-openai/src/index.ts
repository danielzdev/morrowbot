import { runPlugin } from '@morrowbot/plugin-sdk';
import { createCodexProvider } from './provider.ts';

runPlugin(createCodexProvider());
