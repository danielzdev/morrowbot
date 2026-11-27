import type { AccessLevel } from '@morrowbot/contracts';

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  'read-only': 'Read only',
  'workspace-write': 'Edit workspace',
  full: 'Full access',
};
