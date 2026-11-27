import { fileURLToPath } from 'node:url';
import type { ProviderBinding } from '@morrowbot/contracts';
import { startAcpFixture, type AcpFixture } from './acp-fixture.ts';
import type { TestHostOptions } from './test-host.ts';

export { turnMethods } from './acp-fixture.ts';

export const FAKE_OPENCODE = fileURLToPath(new URL('../features/providers/fixtures/fake-opencode.ts', import.meta.url));

export const OPENCODE: Extract<ProviderBinding, { kind: 'bound' }> = {
  kind: 'bound',
  pluginId: 'provider-opencode',
  selection: { kind: 'default' },
  access: 'read-only',
  vendorSettings: 'isolated',
};

/** A host whose built-in OpenCode provider runs the fake opencode, with `$HOME` a temp folder. */
export function startOpenCodeFixture(options: Partial<TestHostOptions> = {}): Promise<AcpFixture> {
  return startAcpFixture({ binding: OPENCODE, fake: FAKE_OPENCODE, stateDir: 'fake-opencode' }, options);
}
