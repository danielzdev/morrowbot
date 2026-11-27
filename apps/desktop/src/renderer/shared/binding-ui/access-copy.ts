import type { AccessLevel, AccessProfile, VendorSettings } from '@morrowbot/contracts';

const LEVEL_NAME: Readonly<Record<AccessLevel, string>> = {
  'read-only': 'Read only',
  'workspace-write': 'Edit workspace',
  full: 'Full access',
};

/** A profile's segment name, from its fields only (spec §4.6), never from the provider's name. */
export function profileName(profile: { readonly access: AccessLevel; readonly vendorSettings: VendorSettings }): string {
  return profile.vendorSettings === 'personal' ? `${LEVEL_NAME[profile.access]} · Personal setup` : LEVEL_NAME[profile.access];
}

/** The one-line description under the segment row. `AccessProfile` has no `shell` field yet, so no shell is claimed. */
export function profileDescription(profile: AccessProfile, approvals: boolean): string {
  const parts: string[] = [];
  switch (profile.access) {
    case 'read-only':
      parts.push("Reads files in the workspace. Can't edit files. Can't run commands.");
      break;
    case 'workspace-write':
      parts.push('Edits files inside the workspace.');
      if (approvals) parts.push('Asks before protected files.');
      break;
    case 'full':
      parts.push('Runs without a sandbox.');
      break;
  }
  if (profile.vendorSettings === 'personal') parts.push('Also loads your personal CLI instructions.');
  return parts.join(' ');
}

/** What the user must accept before using a profile; shown in the warning strip and the confirm. */
export function profileWarnings(profile: AccessProfile): readonly string[] {
  return [
    ...(profile.readsOutsideCwd ? ['Can read your files outside the workspace.'] : []),
    ...(profile.vendorSettings === 'personal' ? ['Also loads your personal CLI instructions.'] : []),
  ];
}

/** A withheld reason as it may be shown (spec §9.1), or the generic line when nothing safe is left. */
export function withheldReason(reason: string, redact: (text: string) => string): string {
  const safe = redact(reason).trim();
  return safe === '' ? 'Not available on this setup.' : safe;
}
