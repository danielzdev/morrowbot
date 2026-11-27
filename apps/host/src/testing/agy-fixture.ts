import { fileURLToPath } from 'node:url';
import type { ProviderBinding } from '@morrowbot/contracts';
import { startAcpFixture, type AcpFixture } from './acp-fixture.ts';
import type { TestHostOptions } from './test-host.ts';

export { turnMethods, type Logged } from './acp-fixture.ts';

export const FAKE_AGY = fileURLToPath(new URL('../features/providers/fixtures/fake-agy.ts', import.meta.url));

export const AGY: Extract<ProviderBinding, { kind: 'bound' }> = {
  kind: 'bound',
  pluginId: 'provider-antigravity',
  selection: { kind: 'default' },
  access: 'read-only',
  vendorSettings: 'personal',
};

export type AgyFixture = AcpFixture;

/** A host whose built-in Antigravity provider runs the fake agy, with `$HOME` a temp folder. */
export function startAgyFixture(options: Partial<TestHostOptions> = {}): Promise<AgyFixture> {
  return startAcpFixture({ binding: AGY, fake: FAKE_AGY, stateDir: 'fake-agy' }, options);
}
