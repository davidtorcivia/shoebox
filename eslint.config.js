import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		// .svelte.ts rune modules are parsed by svelte-eslint-parser too and need
		// the TS parser wired in just like components.
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser } }
	},
	{
		rules: {
			// Underscore-prefixed identifiers are deliberately unused (ignored
			// callback params, placeholder destructures).
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			]
		}
	},
	{
		ignores: [
			'build/**',
			'build-worker/**',
			'.wrangler/**',
			'.svelte-kit/**',
			'static/**',
			'src/lib/server/db/migrations/**',
			'e2e/.data/**',
			'docs/superpowers/**'
		]
	}
);
