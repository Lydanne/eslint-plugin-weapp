/**
 * @fileoverview a weapp eslint
 * @author eslint-plugin-weapp
 */
"use strict";

const js = require("@eslint/js");
const { eslintCompatPlugin } = require("@oxlint/plugins");
const globals = require("globals");
const requireIndex = require("requireindex");
const { name, version } = require("../package.json");
const {
  legacyWeappGlobals,
  pluginName,
  sharedEnv,
  sharedIgnorePatterns,
  sharedRules,
  weappGlobals,
} = require("./shared-config");
const rules = requireIndex(`${__dirname}/rules`);

const plugin = eslintCompatPlugin({
  meta: {
    name,
    version,
  },
  configs: {},
  rules,
  processors: {},
});

Object.assign(plugin.configs, {
  recommended: {
    extends: "eslint:recommended",
    globals: legacyWeappGlobals,
    env: sharedEnv,
    ignorePatterns: sharedIgnorePatterns,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: [pluginName],
    rules: sharedRules,
  },
  "flat/recommended": [
    js.configs.recommended,
    {
      name: `${pluginName}/recommended`,
      ignores: sharedIgnorePatterns,
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        globals: {
          ...globals.browser,
          ...globals.commonjs,
          ...globals.es2021,
          ...globals.node,
          ...weappGlobals,
        },
      },
      plugins: {
        [pluginName]: plugin,
      },
      rules: sharedRules,
    },
  ],
});

module.exports = plugin;
