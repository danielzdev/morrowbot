import type { PluginManifest, PluginRuntime, ProviderPlugin } from '@morrowbot/plugin-sdk';
import * as antigravity from './antigravity/index.ts';
import * as claude from './claude/index.ts';
import * as openai from './openai/index.ts';

/**
 * One provider built into MorrowBot. The host serves it inside its own process, on the same wire
 * protocol as a plugin worker; every CLI it runs still gets its own guarded process group.
 */
export interface ProviderAdapter {
  /** What the Plugins page shows, and the settings it keeps. Its `id` is reserved: a plugin folder cannot take it. */
  readonly manifest: PluginManifest & { readonly kind: 'provider' };
  /** Builds the provider on its runtime. Called again for every (re)start, so no state outlives a restart. */
  readonly create: (runtime: PluginRuntime) => ProviderPlugin;
}

/**
 * The built-in providers, in the order the Plugins page lists them. Adding one is a folder here
 * (importing only the SDK and contracts) and one line below.
 */
export const BUILTIN_PROVIDERS: readonly ProviderAdapter[] = [
  { manifest: claude.manifest, create: claude.createClaudeProvider },
  { manifest: openai.manifest, create: openai.createCodexProvider },
  { manifest: antigravity.manifest, create: antigravity.createAntigravityProvider },
];
