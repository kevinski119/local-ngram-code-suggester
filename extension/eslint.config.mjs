import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
    {
        ignores: ['out/**', 'node_modules/**']
    },
    eslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname
            },
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                fetch: 'readonly',
                AbortSignal: 'readonly',
                __dirname: 'readonly',
                NodeJS: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly'
            }
        },
        plugins: {
            '@typescript-eslint': tseslint
        },
        rules: {
            ...tseslint.configs.recommended.rules,
            '@typescript-eslint/explicit-function-return-type': 'off',
            'no-useless-escape': 'off'
        }
    }
];
