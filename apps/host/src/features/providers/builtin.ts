import type { OpenPluginChannel, PluginManifest } from '@morrowbot/contracts';
import type { Fence } from '@morrowbot/plugin-sdk';
import { BUILTIN_PROVIDERS } from '@morrowbot/providers';
import { inHostChannel } from './in-host-channel.ts';

/** A built-in provider as the plugin host starts it. */
export interface BuiltinProvider {
  readonly manifest: PluginManifest;
  readonly source: 'built-in';
  readonly folder: null;
  readonly launch: (env: Readonly<Record<string, string>>) => OpenPluginChannel;
}

/**
 * Every provider built into Ori Kami, served in the host's process on `platform`, each program it starts behind
 * `fence`. They need no
 * plugins folder, so they are there on the first launch; their settings and on/off switch are saved
 * like a plugin's. Safe mode does not stop them.
 */
export function builtinProviders(platform: NodeJS.Platform, fence: Fence): BuiltinProvider[] {
  return BUILTIN_PROVIDERS.map(({ manifest, create }) => ({ manifest, source: 'built-in', folder: null, launch: (env) => inHostChannel(create, env, platform, fence) }));
}
