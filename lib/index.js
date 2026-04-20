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

const pluginName = "weapp2";
const sharedIgnorePatterns = ["**/miniprogram_npm/*", "**/@babel/*"];
const weappGlobals = {
  wx: "readonly",
  App: "readonly",
  Page: "readonly",
  getCurrentPages: "readonly",
  getApp: "readonly",
  Component: "readonly",
  Behavior: "readonly",
  requirePlugin: "readonly",
  requireMiniProgram: "readonly",
  __wxConfig: "readonly",
  define: "readonly",
  globalThis: "readonly",
};
const legacyWeappGlobals = Object.fromEntries(
  Object.keys(weappGlobals).map((key) => [key, true]),
);
const sharedRules = {
  "weapp2/component": "error",

  "no-unused-vars": "off",
  "no-empty": "off",
  "no-async-promise-executor": "off",
  "no-useless-catch": "off",
  "no-useless-escape": "off",
  "no-redeclare": "warn",
  "no-case-declarations": "warn",
  "no-unreachable": "warn",
  "no-constant-condition": "warn",
  "no-mixed-spaces-and-tabs": "off",
  "no-cond-assign": "warn",
  "no-control-regex": "off",
  "no-extra-semi": "warn",
  "no-dupe-else-if": "warn",
  "no-irregular-whitespace": "warn",
  "no-extra-boolean-cast": "warn",
  "no-prototype-builtins": "warn",
  "no-self-assign": "warn",
  "no-inner-declarations": "warn",
  "no-dupe-keys": "warn",
  "no-empty-pattern": "warn",
  "no-unsafe-negation": "warn",
  "no-shadow-restricted-names": "warn",
  "no-unexpected-multiline": "warn",
  "no-fallthrough": "warn",
  "no-regex-spaces": "warn",
  "no-unused-labels": "warn",
  "no-duplicate-case": "warn",
  "use-isnan": "warn",
};
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
    env: {
      browser: true,
      node: true,
      es2021: true,
      commonjs: true,
    },
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
