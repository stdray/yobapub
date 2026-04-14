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
    plugins: {
      '@stylistic': stylistic,
      'es-x': esX,
    },
    rules: {
      // ── ES2015+ syntax that SWC lowers via Symbol.iterator runtime
      //    helpers — forbidden because Chromium 28 (Tizen 2.3) has no Symbol.
      //    Use indexed for-loops and explicit array access instead.
      'es-x/no-for-of-loops': 'error',
      'es-x/no-spread-elements': 'error',
      'es-x/no-rest-spread-properties': 'error',
      'es-x/no-array-from': 'error',
      'es-x/no-array-of': 'error',
      'es-x/no-symbol': 'error',
      'es-x/no-map': 'error',
      'es-x/no-set': 'error',
      'es-x/no-weak-map': 'error',
      'es-x/no-weak-set': 'error',
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
