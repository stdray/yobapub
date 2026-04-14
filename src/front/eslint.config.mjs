import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import compat from 'eslint-plugin-compat';
import esX from 'eslint-plugin-es-x';

export default tseslint.config(
  {
    ignores: ['dist/**', 'old/**', 'vendor/**', 'node_modules/**', 'scripts/**', 'webpack.config.js', 'postcss.config.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  compat.configs['flat/recommended'],
  {
    plugins: { 'es-x': esX },
    rules: {
      // TypeScript's lib:["ES5","DOM"] + types:[...] is the primary barrier
      // against ES2015+ API usage in source (Array.prototype.find, Map, Symbol,
      // etc.) — when you write `arr.find(...)` tsc reports TS2550 with a hint
      // about changing the lib option. eslint-plugin-compat additionally flags
      // global constructors like `new URL()` / `new Map()`.
      //
      // These three rules cover what TS/compat can't see: iterator-protocol
      // lowering done by SWC at build time. `for...of`, array/argument spread,
      // and object rest/spread all compile to calls that dereference
      // Symbol.iterator, which Chromium 28 (Tizen 2.3) does not have.
      'es-x/no-for-of-loops': 'error',
      'es-x/no-spread-elements': 'error',
      'es-x/no-rest-spread-properties': 'error',
    },
  },
  {
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      // ── Line width ──────────────────────────────────────────────
      '@stylistic/max-len': ['warn', {
        code: 140,
        ignoreUrls: true,
        ignoreStrings: true,       // doT templates are long strings
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
        ignoreComments: false,
      }],

      // ── Function complexity ─────────────────────────────────────
      'max-params': ['warn', { max: 5 }],
      'max-depth': ['warn', { max: 4 }],

      // ── TypeScript strict ───────────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-require-imports': 'off',    // vendor/legacy compat

      // ── General quality ─────────────────────────────────────────
      'no-var': 'error',
      'prefer-const': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],  // != null is idiomatic for null|undefined
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-wrappers': 'error',
      'no-throw-literal': 'error',
      'no-duplicate-imports': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
    },
  },
);
