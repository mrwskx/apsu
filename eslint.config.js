import { configs as airbnb, plugins } from 'eslint-config-airbnb-extended';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier/flat';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.eslint-stubs/**',
      '.husky/_/**',
    ],
  },

  // airbnb ships rule groups and plugin registration separately; the plugins
  // have to be spread in before any config that references their rules.
  plugins.stylistic,
  plugins.importX,
  plugins.node,
  plugins.typescriptEslint,

  ...airbnb.base.typescript,
  ...airbnb.node.recommended,

  {
    // Type-aware linting. `import.meta.dirname` lands in Node 24.0 and is
    // backported to 22.16 only — hence the engines range in package.json,
    // which excludes the 23.x line that never received it.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Layered last so it wins where airbnb is weaker — airbnb leaves
  // no-floating-promises, no-unsafe-assignment and restrict-template-expressions off.
  ...tseslint.configs.strictTypeChecked.map(config => ({
    ...config,
    files: ['**/*.ts'],
  })),
  ...tseslint.configs.stylisticTypeChecked.map(config => ({
    ...config,
    files: ['**/*.ts'],
  })),

  { files: ['**/*.test.ts'], ...vitest.configs.recommended },

  prettier,
];
