import eslint from '@eslint/js'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** @type {import('eslint').Linter.Config[]} */
export default tseslint.config(
    // Global ignores (must be standalone config object)
    {
        ignores: ['eslint.config.mjs', '**/dist/**', '**/node_modules/**', '**/build/**', '**/.next/**', '**/out/**'],
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

    // Browser globals for web workspace
    {
        files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
        languageOptions: {
            globals: { ...globals.browser },
        },
    },

    // JS files: turn off typed linting
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        extends: [tseslint.configs.disableTypeChecked],
    },
)
