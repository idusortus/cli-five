// Flat ESLint config (ESLint 10). A focused correctness ruleset rather than a
// style pass, so the repo can adopt linting without a formatting migration.
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'docs/**',
      'plugin-agents/**',
      '.github/**',
      '.opencode/**',
      '**/*.tmpl',
    ],
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'after-used', ignoreRestSiblings: true }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
];
