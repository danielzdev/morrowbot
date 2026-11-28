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
  await fake.file('Applications/Ori Bot.app/Contents/Info.plist', INFO_PLIST('com.legendarykoi.oribot'));
  const execPath = `${fake.home}/Applications/Ori Bot.app/Contents/MacOS/Ori Bot`;
  const [reset] = await resetOptionsOf(fake.context('installed', '.oribot', []), { packaged: true, execPath, updatePending: false }, fakeKeychain([VAULT_KEY]));
  if (reset?.kind !== 'available') return reset;
  const isVault = (text: string): boolean => text.includes('vault');
  return fake.short({
    steps: reset.steps.flatMap((step) => (step.kind === 'delete' ? (isVault(step.path) ? [step.path] : []) : step.kind === 'keychain' ? [`Keychain: ${step.service} / ${step.account}`] : [])),
    kept: reset.kept.filter((each) => isVault(each.path)),
  });
}

it("deletes the vault's files and its Keychain master key with the rest of the data", async () => {
  for (const name of ['vault.json', 'vault-secrets.json', 'vault.key']) await fake.file(`.oribot/${name}`);
  expect(await vaultPlan()).toEqual({
    steps: ['~/.oribot/vault.json', '~/.oribot/vault-secrets.json', '~/.oribot/vault.key', 'Keychain: com.legendarykoi.oribot.vault / master-key'],
    kept: [],
  });
});

it('keeps the master key while the sealed secrets it unlocks stay', async () => {
  await fake.file('elsewhere/vault-secrets.json');
  await fake.link('.oribot/vault-secrets.json', `${fake.home}/elsewhere/vault-secrets.json`);
  expect(await vaultPlan()).toEqual({
    steps: [],
    kept: [
      { path: '~/.oribot/vault-secrets.json', reason: 'A symbolic link. Ori Bot does not follow it.' },
      { path: 'Keychain: com.legendarykoi.oribot.vault (account master-key)', reason: 'It unlocks the vault secrets that stay.' },
    ],
  });
});
