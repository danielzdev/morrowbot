import {
  type PluginEntry,
  type PluginList,
  type PluginManifest,
  SetPluginConfigRequest,
  SetPluginEnabledRequest,
} from '@morrowbot/contracts';
import type { ApiServices } from './ports.ts';
import { json, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

/** Plugins the user has never switched off are enabled. */
export function pluginRoutes({ plugins, now }: ApiServices): Route[] {
  const entry = (manifest: PluginManifest): PluginEntry => ({
    manifest,
    enabled: plugins.settings.enabledStates().get(manifest.id) ?? true,
    config: plugins.settings.configs().get(manifest.id) ?? {},
  });
  const find = (id: string): PluginManifest | undefined => plugins.catalog.list().find((manifest) => manifest.id === id);

  return [
    {
      method: 'GET',
      path: /^\/api\/plugins$/,
      handle: () => {
        const body: PluginList = { plugins: plugins.catalog.list().map(entry) };
        return json(200, body);
      },
    },
    {
      method: 'PUT',
      path: /^\/api\/plugins\/([^/]+)\/enabled$/,
      handle: async (context) => {
        const manifest = find(context.id);
        if (manifest === undefined) return notFound('Plugin');
        const request = await parseBody(context, SetPluginEnabledRequest);
        if (request.kind === 'rejected') return request.reply;
        plugins.settings.setEnabled(manifest.id, request.value.enabled, now());
        return json(200, entry(manifest));
      },
    },
    {
      method: 'PUT',
      path: /^\/api\/plugins\/([^/]+)\/config$/,
      handle: async (context) => {
        const manifest = find(context.id);
        if (manifest === undefined) return notFound('Plugin');
        const request = await parseBody(context, SetPluginConfigRequest);
        if (request.kind === 'rejected') return request.reply;
        plugins.settings.setConfig(manifest.id, request.value.config, now());
        return json(200, entry(manifest));
      },
    },
  ];
}
