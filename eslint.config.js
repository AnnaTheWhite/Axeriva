import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// This repo is two applications in one tree: a browser frontend at the root
// (src/) and a Node backend under server/. Before v1.0 #2 there was a single
// block matching '**/*.{ts,tsx}' with browser globals and React rules, so the
// React ruleset was applied to Express route handlers and the compiled build
// output was linted as if it were source. Each surface now gets the rules and
// globals that actually belong to it.

// Shared unused-variable policy. Two deliberate allowances, both conventions
// rather than suppressions:
//   - `^_` prefix: Express's error handler must declare all four parameters
//     (err, req, res, next) for Express to recognize it as an error handler,
//     even when `next` goes unused — `_next` is how that intent is written.
//   - caughtErrors 'none': `catch (error)` blocks that deliberately swallow
//     the error and return a generic response are a security pattern in this
//     codebase (see the auth routes), not an oversight.
const noUnusedVars = [
  'error',
  { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
]

export default defineConfig([
  // Build output and generated artifacts are not source. 'dist' covers the
  // frontend bundle; 'server/dist' is the compiled backend, which used to be
  // linted because the root-relative 'dist' pattern never matched it.
  globalIgnores(['dist', 'server/dist', 'server/prisma/migrations']),

  // --- Frontend (browser) ---
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': noUnusedVars,
    },
  },

  // --- Backend (Node) ---
  // No React plugins here: react-hooks and react-refresh have nothing to say
  // about an Express server, and applying them produced only noise.
  {
    files: ['server/src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': noUnusedVars,
      // `declare global { namespace Express { interface Request … } }` in
      // auth.middleware.ts is the only supported way to augment Express's
      // request type. allowDeclarations permits exactly that form while still
      // rejecting namespaces used as a module system.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },

  // --- Build / tooling configuration ---
  // vite.config.ts, this file, server/vitest.config.ts, server/prisma.config.ts.
  // They run in Node and were not linted at all under the previous scoping.
  {
    files: ['*.{ts,js}', 'server/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': noUnusedVars,
    },
  },
])
