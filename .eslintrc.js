/**
 * eslint-plugin-n8n-nodes-base lints n8n community nodes against the same
 * rules the n8n team uses for built-in nodes. Passing this is one of the
 * requirements for submission to the verified community node program.
 *
 * https://docs.n8n.io/integrations/creating-nodes/test/lint/
 */
module.exports = {
  root: true,
  env: { browser: false, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['dist/**', 'node_modules/**', '*.js'],
  overrides: [
    {
      files: ['package.json'],
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/community'],
      rules: {
        'n8n-nodes-base/community-package-json-name-still-default': 'off',
      },
    },
    {
      files: ['credentials/**/*.ts'],
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/credentials'],
      rules: {
        // Buggy autofix mangles HTTPS URLs into camelCase identifiers; we keep
        // the real URL and silence the rule. https://github.com/Iuyiga/eslint-plugin-n8n-nodes-base/issues
        'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
      },
    },
    {
      files: ['nodes/**/*.ts'],
      plugins: ['eslint-plugin-n8n-nodes-base'],
      extends: ['plugin:n8n-nodes-base/nodes'],
    },
  ],
};
