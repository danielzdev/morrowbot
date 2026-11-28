import { afterEach, beforeEach, expect, it } from 'vitest';
import { fakeHome, fakeKeychain, INFO_PLIST, type FakeHome } from './reset-fixture.ts';
import { VAULT_KEY } from './reset-paths.ts';
import { resetOptionsOf } from './reset-plan.ts';

let fake: FakeHome;
beforeEach(async () => {
  fake = await fakeHome();
});
afterEach(async () => {
  await fake.remove();
});

/** The installed app's reset plan: its vault steps, and what it keeps of the vault. */
async function vaultPlan(): Promise<unknown> {
  await fake.file('Applications/Ori Kami.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.orikami'));
  const execPath = `${fake.home}/Applications/Ori Kami.app/Contents/MacOS/Ori Kami`;
  const [reset] = await resetOptionsOf(fake.context('installed', '.orikami', []), { packaged: true, execPath, updatePending: false }, fakeKeychain([VAULT_KEY]));
  if (reset?.kind !== 'available') return reset;
  const isVault = (text: string): boolean => text.includes('vault');
  return fake.short({
    steps: reset.steps.flatMap((step) => (step.kind === 'delete' ? (isVault(step.path) ? [step.path] : []) : step.kind === 'keychain' ? [`Keychain: ${step.service} / ${step.account}`] : [])),
    kept: reset.kept.filter((each) => isVault(each.path)),
  });
}

it("deletes the vault's files and its Keychain master key with the rest of the data", async () => {
  for (const name of ['vault.json', 'vault-secrets.json', 'vault.key']) await fake.file(`.orikami/${name}`);
  expect(await vaultPlan()).toEqual({
    steps: ['~/.orikami/vault.json', '~/.orikami/vault-secrets.json', '~/.orikami/vault.key', 'Keychain: com.legendarykoi.orikami.vault / master-key'],
    kept: [],
  });
});

it('keeps the master key while the sealed secrets it unlocks stay', async () => {
  await fake.file('elsewhere/vault-secrets.json');
  await fake.link('.orikami/vault-secrets.json', `${fake.home}/elsewhere/vault-secrets.json`);
  expect(await vaultPlan()).toEqual({
    steps: [],
    kept: [
      { path: '~/.orikami/vault-secrets.json', reason: 'A symbolic link. Ori Kami does not follow it.' },
      { path: 'Keychain: com.legendarykoi.orikami.vault (account master-key)', reason: 'It unlocks the vault secrets that stay.' },
    ],
  });
});
