import type { VaultItem } from '@morrowbot/contracts';
import { expect, it } from 'vitest';
import { draftOf, updateVaultRequest } from './vault.ts';

const LOGIN: VaultItem = {
  kind: 'login',
  id: 'item-1',
  label: 'Git forge',
  site: 'git.example',
  username: 'robot',
  hasTotp: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

it('sends only what the form changed, so blank secret fields keep the saved secrets', () => {
  const opened = draftOf(LOGIN);
  expect({
    untouched: updateVaultRequest(LOGIN, opened),
    renamed: updateVaultRequest(LOGIN, { ...opened, label: ' Forge ', site: '' }),
    newPassword: updateVaultRequest(LOGIN, { ...opened, secret: ' new pass ' }),
    newKey: updateVaultRequest(LOGIN, { ...opened, twoStepKey: 'JBSWY3DPEHPK3PXP' }),
    removedKey: updateVaultRequest(LOGIN, { ...opened, removeTwoStepKey: true }),
  }).toEqual({
    untouched: { kind: 'login' },
    renamed: { kind: 'login', label: 'Forge', site: null },
    newPassword: { kind: 'login', password: ' new pass ' },
    newKey: { kind: 'login', twoStepKey: 'JBSWY3DPEHPK3PXP' },
    removedKey: { kind: 'login', twoStepKey: null },
  });
});
