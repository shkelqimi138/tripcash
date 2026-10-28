import js from '@eslint/js';
import globals from 'globals';

const shared = {
  ...js.configs.recommended.rules,
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Input sanitizers intentionally match control characters.
  'no-control-regex': 'off',
  'no-regex-spaces': 'off',
  // Explicit initial values such as `let response = null` are kept for readability.
  'no-useless-assignment': 'off',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
};

export default [
  {
    ignores: [
      'android/',
      'artifacts/',
      'dist/',
      'ios/',
      'node_modules/',
      'playwright-report/',
      'supabase/',
      'test-results/',
    ],
  },
  {
    // Browser scripts are classic <script> tags that share one global scope,
    // so top-level names are used across files and cannot be checked per file.
    files: ['web/scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: globals.browser,
    },
    rules: {
      ...shared,
      'no-undef': 'off',
      'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['functions/**/*.js', 'scripts/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.serviceworker },
    },
    rules: shared,
  },
  {
    files: ['playwright.config.cjs', 'tests/**/*.{js,cjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: shared,
  },
  {
    // page.evaluate() callbacks run inside the app and use its globals.
    files: ['tests/e2e/**/*.js'],
    rules: { 'no-undef': 'off' },
  },
];
