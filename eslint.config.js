// Flat ESLint config (ESLint 10). Pragmatic: TypeScript + React Hooks rules for
// the extension source, plain-JS recommended for the Node server. TypeScript's
// own strict compiler (tsc --noEmit) remains the primary gate; this catches the
// things the type-checker doesn't (hook misuse, unused vars, empty blocks).
//
// eslint-plugin-react-hooks v7 ships flat-config presets (recommended-latest et
// al.) that also turn on its React Compiler rule set. We deliberately keep the
// manual two-rule wiring below instead: those are the rules this codebase has
// opted into, and adopting the preset would enable a much larger set as a side
// effect of a dependency bump rather than a considered decision.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', '**/node_modules/**', 'coverage/**'],
  },

  // Extension source — TypeScript + React (content scripts, popup, options, etc.)
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // The text normalizer intentionally matches nbsp / unicode dashes inside
      // regex character classes, so don't flag irregular whitespace there.
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true }],
      // `any` is discouraged but not blocking — flag it for review.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow intentionally-unused args/vars when prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Build/config files run under Node.
  {
    files: ['*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Server — plain JavaScript ES modules on Node.
  {
    files: ['server/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
);
