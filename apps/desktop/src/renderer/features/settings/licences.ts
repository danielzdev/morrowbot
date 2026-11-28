/** One open-source component that ships inside Ori Bot; `npm` is its package name, or null for adapted source. */
export interface Licence {
  readonly name: string;
  readonly npm: string | null;
  readonly licence: string;
}

/** Settings › About › Third-party licences. `checks/licences.test.ts` keeps it in step with the runtime dependencies. */
export const LICENCES: readonly Licence[] = [
  { name: 'Croner', npm: 'croner', licence: 'MIT' },
  { name: 'Electron', npm: 'electron', licence: 'MIT' },
  { name: 'electron-updater', npm: 'electron-updater', licence: 'MIT' },
  { name: 'open-bot-avatar', npm: 'open-bot-avatar', licence: 'MIT' },
  { name: 'Preact', npm: 'preact', licence: 'MIT' },
  { name: 'uqr', npm: 'uqr', licence: 'MIT' },
  { name: 'T3 Code (adapted source)', npm: null, licence: 'MIT' },
  { name: 'ws', npm: 'ws', licence: 'MIT' },
  { name: 'Zod', npm: 'zod', licence: 'MIT' },
];
