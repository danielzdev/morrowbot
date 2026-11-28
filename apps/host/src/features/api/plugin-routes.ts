import {
  type PluginEntry,
  type PluginList,
  type PluginManifest,
  type PluginOrigin,
  type PluginStatus,
  type ProviderInfoResponse,
  type ReleaseGroupResponse,
  SetPluginConfigRequest,
  SetPluginEnabledRequest,
} from '@morrowbot/contracts';
import type { ApiPlugins, ApiServices } from './ports.ts';
import { failure, json, notFound } from './reply.ts';
import { parseBody, type Route } from './route.ts';

type Summary = { readonly manifest: PluginManifest; readonly source: PluginOrigin; readonly status: PluginStatus };

/** Plugins the user has never switched off are enabled. */
async function toEntry(plugins: ApiPlugins, { manifest, source, status }: Summary): Promise<PluginEntry> {
  const saved = await plugins.saved(manifest.id);
  return {
    manifest,
    source,
    status,
    enabled: saved?.enabled ?? true,
    config: saved?.config ?? {},
    blockedGroups: plugins.blockedGroups(manifest.id),
  };
}

export function pluginRoutes({ plugins, chat }: ApiServices): Route[] {
  const find = (id: string): Summary | undefined => plugins.list().find(({ manifest }) => manifest.id === id);
  const isProvider = (id: string): boolean => find(id)?.manifest.kind === 'provider';

  const listBody = async (): Promise<PluginList> => ({
    plugins: await Promise.all(plugins.list().map((summary) => toEntry(plugins, summary))),
    safeMode: plugins.safeMode,
    pluginsDir: plugins.pluginsDir,
    problems: [...plugins.problems()],
  });

  return [
    {
      method: 'GET',
      path: '/api/plugins',
      handle: async () => json(200, await listBody()),
    },
    {
      method: 'POST',
      path: '/api/plugins/rescan',
      handle: async () => {
        await plugins.rescan();
        return json(200, await listBody());
      },
    },
    {
      method: 'POST',
      path: '/api/plugins/:id/restart',
      handle: async ({ params }) => {
        const id = params.get('id');
        if (find(id) === undefined) return notFound('Plugin');
        const result = await plugins.restart(id);
        switch (result) {
          case 'restarted': {
            const summary = find(id);
            return summary === undefined ? notFound('Plugin') : json(200, await toEntry(plugins, summary));
          }
          case 'safe-mode':
            return failure('conflict', 'Plugins stay off in safe mode. Restart Ori Bot normally first.');
          case 'disabled':
            return failure('conflict', 'Turn this plugin on before restarting it.');
          case 'quarantined':
            return failure('conflict', 'Release its blocked process group before restarting it.');
          case 'busy':
            return failure('conflict', 'Stop the turns using this plugin before restarting it.');
        }
      },
    },
    {
      method: 'PUT',
      path: '/api/plugins/:id/enabled',
      handle: async (context) => {
        const id = context.params.get('id');
        const summary = find(id);
        if (summary === undefined) return notFound('Plugin');
        const request = await parseBody(context, SetPluginEnabledRequest);
        if (request.kind === 'rejected') return request.reply;
        await plugins.setEnabled(id, request.value.enabled);
        return json(200, await toEntry(plugins, find(id) ?? summary));
      },
    },
    {
      method: 'PUT',
      path: '/api/plugins/:id/config',
      handle: async (context) => {
        const id = context.params.get('id');
        const summary = find(id);
        if (summary === undefined) return notFound('Plugin');
        const request = await parseBody(context, SetPluginConfigRequest);
        if (request.kind === 'rejected') return request.reply;
        const result = await plugins.setConfig(id, request.value.config);
        switch (result.kind) {
          case 'ok':
            return json(200, await toEntry(plugins, find(id) ?? summary));
          case 'invalid':
            return failure('invalid_request', result.problems.join('; '));
        }
      },
    },
    {
      method: 'GET',
      path: '/api/plugins/:id/info',
      handle: async ({ params, query }) => {
        const id = params.get('id');
        if (!isProvider(id)) return notFound('Provider plugin');
        const result = await plugins.info(id, query.get('refresh') === '1');
        if (result.kind === 'unavailable') return failure('conflict', result.reason);
        const body: ProviderInfoResponse = { info: result.info };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/plugins/:id/recheck',
      handle: async ({ params }) => {
        const id = params.get('id');
        if (!isProvider(id)) return notFound('Provider plugin');
        const result = await chat.recheck(id);
        switch (result.kind) {
          case 'ok': {
            const body: ProviderInfoResponse = { info: result.info };
            return json(200, body);
          }
          case 'busy':
            return failure('conflict', 'Stop the turns using this provider before rechecking it.');
          case 'blocked':
            return failure('conflict', result.detail);
          case 'unavailable':
            return failure('conflict', result.reason);
        }
      },
    },
    {
      method: 'GET',
      path: '/api/plugins/:id/usage',
      handle: async ({ params, query }) => {
        const id = params.get('id');
        if (!isProvider(id)) return notFound('Provider plugin');
        const result = await chat.usage(id, query.get('refresh') === '1');
        return result.kind === 'ok' ? json(200, result.response) : failure('conflict', result.reason);
      },
    },
    {
      method: 'POST',
      path: '/api/child-groups/:regId/release',
      handle: ({ params }) => {
        switch (plugins.releaseGroup(params.get('regId'))) {
          case 'released': {
            const body: ReleaseGroupResponse = { released: true };
            return json(200, body);
          }
          case 'not-found':
            return notFound('Process group');
          case 'not-blocked':
            return failure('conflict', 'This process group is not blocked.');
          case 'too-early':
            return failure('conflict', 'Release anyway is offered after 60 seconds blocked.');
        }
      },
    },
  ];
}
