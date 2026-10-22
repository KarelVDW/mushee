import eslint from '@eslint/js'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
    // Global ignores (must be standalone config object)
    {
        ignores: [
            'eslint.config.mjs',
            '**/dist/**',
            '**/node_modules/**',
            '**/build/**',
            '**/.next/**',
            '**/.next-e2e/**',
            '**/.next-verify/**',
            '**/out/**',
            '**/coverage/**',
            // Local Python venvs (apps/api's CREPE and pitch-bench tooling, synthetic-corpus) ship their own JS assets
            '**/.venv/**',
            '**/.venv-*/**',
            // Claude Code scratch worktrees are throwaway repo copies, not source
            '**/.claude/**',
        ],
    },
    {
        linterOptions: { reportUnusedDisableDirectives: 'error' },
    },

    // Base configs
    eslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,

    // Project-aware TypeScript + shared plugin setup
    {
        plugins: {
            'simple-import-sort': simpleImportSort,
            'unused-imports': unusedImports,
        },
        languageOptions: {
            globals: { ...globals.node },
            parserOptions: {
                projectService: true,
                allowDefaultProject: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',
            'simple-import-sort/imports': 'error',
            'simple-import-sort/exports': 'error',
            '@typescript-eslint/no-unused-vars': 'off',
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
        },
    },

    // Browser globals for the web workspaces
    {
        files: [
            'apps/web/**/*.ts',
            'apps/web/**/*.tsx',
            'apps/admin/**/*.ts',
            'apps/admin/**/*.tsx',
            'packages/notation/**/*.ts',
            'packages/notation/**/*.tsx',
        ],
        languageOptions: {
            globals: { ...globals.browser },
        },
    },

    // Notation: type-only imports say so, so the source import graph shows only the runtime
    // dependencies (no apparent Clef↔ClefLayout or Score↔ScoreSerializer cycles). Scoped to the
    // package: in apps/api a type import of a constructor-injected class would drop its DI metadata.
    {
        files: ['packages/notation/**/*.ts', 'packages/notation/**/*.tsx'],
        rules: {
            '@typescript-eslint/consistent-type-imports': 'error',
        },
    },

    // JS files: turn off typed linting
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        extends: [tseslint.configs.disableTypeChecked],
    },

    // Tiny CommonJS shim package (proto path exports); it belongs to no
    // tsconfig project and legitimately uses require().
    {
        files: ['packages/inference-proto/**'],
        extends: [tseslint.configs.disableTypeChecked],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
)
