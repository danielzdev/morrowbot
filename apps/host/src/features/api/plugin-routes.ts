import {
  type PluginEntry,
  type PluginList,
  type PluginManifest,
  type PluginStatus,
  SetPluginConfigRequest,
  SetPluginEnabledRequest,
} from '@morrowbot/contracts';
import type { ApiPlugins, ApiServices } from './ports.ts';
import { failure, json, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

type Summary = { readonly manifest: PluginManifest; readonly status: PluginStatus };

/** Plugins the user has never switched off are enabled. */
async function toEntry(plugins: ApiPlugins, { manifest, status }: Summary): Promise<PluginEntry> {
  const saved = await plugins.saved(manifest.id);
  return { manifest, status, enabled: saved?.enabled ?? true, config: saved?.config ?? {} };
}

export function pluginRoutes({ plugins }: ApiServices): Route[] {
  const find = (id: string): Summary | undefined => plugins.list().find(({ manifest }) => manifest.id === id);

  return [
    {
      method: 'GET',
      path: /^\/api\/plugins$/,
      handle: async () => {
        const body: PluginList = { plugins: await Promise.all(plugins.list().map((summary) => toEntry(plugins, summary))) };
        return json(200, body);
      },
    },
    {
      method: 'PUT',
      path: /^\/api\/plugins\/([^/]+)\/enabled$/,
      handle: async (context) => {
        const summary = find(context.id);
        if (summary === undefined) return notFound('Plugin');
        const request = await parseBody(context, SetPluginEnabledRequest);
        if (request.kind === 'rejected') return request.reply;
        await plugins.setEnabled(context.id, request.value.enabled);
        return json(200, await toEntry(plugins, find(context.id) ?? summary));
      },
    },
    {
      method: 'PUT',
      path: /^\/api\/plugins\/([^/]+)\/config$/,
      handle: async (context) => {
        const summary = find(context.id);
        if (summary === undefined) return notFound('Plugin');
        const request = await parseBody(context, SetPluginConfigRequest);
        if (request.kind === 'rejected') return request.reply;
        const result = await plugins.setConfig(context.id, request.value.config);
        switch (result.kind) {
          case 'ok':
            return json(200, await toEntry(plugins, find(context.id) ?? summary));
          case 'invalid':
            return failure('invalid_request', result.problems.join('; '));
        }
      },
    },
  ];
}
