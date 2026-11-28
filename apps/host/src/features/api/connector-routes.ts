import {
  CreateConnectorRequest,
  SetConnectorEnabledRequest,
  SetConnectorScopeRequest,
  UpdateConnectorAccountRequest,
  type Connector,
  type ConnectorList,
} from '@morrowbot/contracts';
import type { ApiConnectorSave, ApiServices } from './ports.ts';
import { failure, json, noContent, notFound, scopeConflict, type Reply } from './reply.ts';
import { parseBody, type Route } from './route.ts';

/** How long Connect waits for the session before answering with Starting (the window then looks again). */
const CONNECT_WAIT_MS = 5_000;
const LABEL_TAKEN = 'That name is already in use. Enter a different name.';

const saved = (status: number, result: ApiConnectorSave): Reply => {
  switch (result.kind) {
    case 'saved':
      return json(status, result.connector);
    case 'not-found':
      return notFound('Connector');
    case 'label-taken':
      return failure('conflict', LABEL_TAKEN);
    case 'invalid':
      return failure('invalid_request', result.reason);
  }
};

/** Waits up to `CONNECT_WAIT_MS` for the connector's session to settle, then answers with how it stands. */
async function afterSettling(connectors: ApiServices['connectors'], status: number, id: string): Promise<Reply> {
  await Promise.race([
    connectors.settled(id),
    new Promise<void>((resolve) => {
      setTimeout(resolve, CONNECT_WAIT_MS).unref();
    }),
  ]);
  const connector = connectors.get(id);
  return connector === undefined ? notFound('Connector') : json(status, connector);
}

export function connectorRoutes({ connectors }: ApiServices): Route[] {
  const changed = (status: number, result: ApiConnectorSave): Promise<Reply> | Reply =>
    result.kind === 'saved' ? afterSettling(connectors, status, result.connector.id) : saved(status, result);
  const settledOrMissing = (id: string, connector: Connector | undefined): Promise<Reply> | Reply =>
    connector === undefined ? notFound('Connector') : afterSettling(connectors, 200, id);
  return [
    {
      method: 'GET',
      path: '/api/connectors',
      handle: () => {
        const body: ConnectorList = { connectors: connectors.list(), safeMode: connectors.safeMode };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/connectors',
      handle: async (context) => {
        const request = await parseBody(context, CreateConnectorRequest);
        return request.kind === 'rejected' ? request.reply : changed(201, connectors.create(request.value));
      },
    },
    {
      method: 'PUT',
      path: '/api/connectors/:id/account',
      handle: async (context) => {
        const request = await parseBody(context, UpdateConnectorAccountRequest);
        return request.kind === 'rejected' ? request.reply : changed(200, connectors.updateAccount(context.params.get('id'), request.value));
      },
    },
    {
      method: 'PUT',
      path: '/api/connectors/:id/enabled',
      handle: async (context) => {
        const request = await parseBody(context, SetConnectorEnabledRequest);
        if (request.kind === 'rejected') return request.reply;
        const id = context.params.get('id');
        return settledOrMissing(id, connectors.setEnabled(id, request.value.enabled));
      },
    },
    {
      method: 'PUT',
      path: '/api/connectors/:id/scope',
      handle: async (context) => {
        const request = await parseBody(context, SetConnectorScopeRequest);
        if (request.kind === 'rejected') return request.reply;
        const result = connectors.setScope(context.params.get('id'), request.value);
        switch (result.kind) {
          case 'saved':
            return json(200, result.connector);
          case 'not-found':
            return notFound('Connector');
          case 'conflict':
            return scopeConflict(result.current);
          case 'invalid':
            return failure('invalid_request', result.reason);
        }
      },
    },
    {
      method: 'POST',
      path: '/api/connectors/:id/connect',
      handle: ({ params }) => settledOrMissing(params.get('id'), connectors.connect(params.get('id'))),
    },
    {
      method: 'POST',
      path: '/api/connectors/:id/disconnect',
      handle: ({ params }) => settledOrMissing(params.get('id'), connectors.disconnect(params.get('id'))),
    },
    {
      method: 'DELETE',
      path: '/api/connectors/:id',
      handle: async ({ params }) => ((await connectors.remove(params.get('id'))) ? noContent() : notFound('Connector')),
    },
  ];
}
