// ESLint 9 (flat config). Przeglądarka: js/, Node: tools/ i tests/.
import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, L: 'readonly' },
    },
  },
  {
    files: ['tools/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { ignores: ['vendor/**', 'ztm-izochrony/**', 'node_modules/**', 'data/**', 'gtfs-src/**'] },
];
