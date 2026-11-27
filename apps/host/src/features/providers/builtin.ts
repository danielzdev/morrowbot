import type { OpenPluginChannel, PluginManifest } from '@morrowbot/contracts';
import { BUILTIN_PROVIDERS } from '@morrowbot/providers';
import { inHostChannel } from './in-host-channel.ts';

/** A built-in provider as the plugin host starts it. */
export interface BuiltinProvider {
  readonly manifest: PluginManifest;
  readonly launch: (env: Readonly<Record<string, string>>) => OpenPluginChannel;
}

/**
 * Every provider built into MorrowBot, served in the host's process on `platform`. They need no
 * plugins folder, so they are there on the first launch; their settings and on/off switch are saved
 * like a plugin's.
 */
export function builtinProviders(platform: NodeJS.Platform): BuiltinProvider[] {
  return BUILTIN_PROVIDERS.map(({ manifest, create }) => ({ manifest, launch: (env) => inHostChannel(create, env, platform) }));
}
