/**
 * ESLint flat config.
 *
 * Next 15 still publishes eslintrc-style shareable configs, so `FlatCompat`
 * bridges them. Rules mirror the root repository (CLAUDE.md "Key Conventions") so
 * a reviewer moving between the two projects keeps the same floor.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) })

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts', 'data/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      'prefer-const': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Direct `/api/v1` fetches bypass the CSRF header and the shared 401 handling,
    // so they are a lint error rather than a review comment.
    files: ['src/components/**/*.tsx', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='fetch'][arguments.0.type='Literal'][arguments.0.value=/^\\/api\\/v1\\//]",
          message:
            'Call /api/v1 through `@/lib/api/client` so CSRF, the response envelope and 401 handling stay in one place.',
        },
      ],
    },
  },
]

export default config
