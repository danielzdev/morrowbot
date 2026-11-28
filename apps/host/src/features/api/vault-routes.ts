import { CreateVaultItemRequest, UpdateVaultItemRequest, type VaultItemList } from '@morrowbot/contracts';
import type { ApiServices, ApiVaultSave } from './ports.ts';
import { failure, json, noContent, notFound, type Reply } from './reply.ts';
import { parseBody, type Route } from './route.ts';

/** A request carries at most a few short secrets. */
const VAULT_BODY_BYTES = 64 * 1024;

/** Settings › Vault, for the owner only. Replies carry item names; a secret value goes in and never comes back out. */
export function vaultRoutes({ vault }: ApiServices): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/vault',
      handle: () => {
        const body: VaultItemList = { items: vault.list() };
        return json(200, body);
      },
    },
    {
      method: 'POST',
      path: '/api/vault',
      bodyBytes: VAULT_BODY_BYTES,
      handle: async (context) => {
        const request = await parseBody(context, CreateVaultItemRequest);
        return request.kind === 'rejected' ? request.reply : saved(await vault.create(request.value), 201);
      },
    },
    {
      method: 'PATCH',
      path: '/api/vault/:id',
      bodyBytes: VAULT_BODY_BYTES,
      handle: async (context) => {
        const request = await parseBody(context, UpdateVaultItemRequest);
        return request.kind === 'rejected' ? request.reply : saved(await vault.update(context.params.get('id'), request.value), 200);
      },
    },
    {
      method: 'DELETE',
      path: '/api/vault/:id',
      handle: async ({ params }) => ((await vault.delete(params.get('id'))) ? noContent() : notFound('Vault item')),
    },
  ];
}

function saved(result: ApiVaultSave, status: number): Reply {
  switch (result.kind) {
    case 'saved':
      return json(status, result.item);
    case 'not-found':
      return notFound('Vault item');
    case 'invalid':
      return failure('invalid_request', result.reason);
  }
}
