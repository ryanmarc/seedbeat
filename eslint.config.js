// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/.vite/**',
      '**/node_modules/**',
      'tools/golden/fixtures/**',
      'playwright-report/**',
      'test-results/**',
      // Handoff kit, local only
      'docs/**',
      'reference/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // packages/core must stay pure and deterministic (same seed → byte-identical output everywhere).
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'core is deterministic: no wall-clock time.' },
        { name: 'window', message: 'core has no DOM.' },
        { name: 'document', message: 'core has no DOM.' },
        { name: 'performance', message: 'core has no clocks.' },
        { name: 'setTimeout', message: 'core has no timers.' },
        { name: 'setInterval', message: 'core has no timers.' },
        { name: 'crypto', message: 'core uses its own seeded PRNG.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'core is deterministic: use rngFor().' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'path', 'os', 'crypto'], message: 'core has no I/O.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
