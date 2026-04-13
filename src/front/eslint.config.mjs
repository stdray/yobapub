import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  {
    ignores: ['dist/**', 'old/**', 'vendor/**', 'node_modules/**', 'scripts/**', 'webpack.config.js', 'postcss.config.js'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
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
