import { runPlugin } from '@morrowbot/plugin-sdk';
import { createClaudeProvider } from './provider.ts';

runPlugin(createClaudeProvider());
