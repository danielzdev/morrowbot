import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { importBoundariesConfig } from './tools/eslint/import-boundaries.ts';

export default defineConfig(
  { ignores: ['**/node_modules/', '**/dist/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'max-lines': ['error', { max: 400 }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
    },
  },
  {
    files: ['packages/plugin-sdk/src/**/*.ts', 'packages/providers/src/**/*.ts'],
    ignores: ['**/*.test.ts', 'packages/plugin-sdk/src/testing/**'],
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
    },
  },
  importBoundariesConfig,
);
