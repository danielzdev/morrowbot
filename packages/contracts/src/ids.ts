import { z } from 'zod';
import { PluginManifest } from './plugin-manifest.ts';

export const EntityId = z.string().min(1).max(128);
export type EntityId = z.infer<typeof EntityId>;

export const PluginId = PluginManifest.shape.id;
export type PluginId = z.infer<typeof PluginId>;

export const Timestamp = z.iso.datetime();
export type Timestamp = z.infer<typeof Timestamp>;
