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
const { WXMLLanguage } = require("./languages/wxml-language");

const plugin = eslintCompatPlugin({
  meta: {
    name,
    version,
  },
  configs: {},
  rules,
  processors: {},
});

// languages 在 compat 包装后补挂；@oxlint/plugins 的 compat 不处理 languages，
// 也不会把 JSON/CSS/WXML 规则发给 oxlint（oxlint 只看 JS rules）。
plugin.languages = {
  wxml: new WXMLLanguage(),
};

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
      // 把 .wxs 纳入 JS lint 范围；wxs 是 ES5 子集，espree 能直接 parse，
      // 其中的 require() 会被 weapp2/import 捕获。
      files: ["**/*.{js,mjs,cjs,ts,wxs}"],
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
