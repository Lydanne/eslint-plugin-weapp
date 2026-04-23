/**
 * @fileoverview a weapp eslint
 * @author eslint-plugin-weapp
 */
"use strict";

const js = require("@eslint/js");
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
const json = optionalPlugin("@eslint/json");
const css = optionalPlugin("@eslint/css");

const plugin = {
  meta: {
    name,
    version,
  },
  configs: {},
  rules,
  processors: {},
  languages: {
    wxml: new WXMLLanguage(),
  },
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
      rules: {
        ...js.configs.recommended.rules,
        ...sharedRules,
      },
    },
  ],
});

plugin.configs["flat/weapp"] = createFlatWeappConfig();

module.exports = plugin;

function createFlatWeappConfig() {
  const configs = [...plugin.configs["flat/recommended"]];

  if (json) {
    configs.push({
      name: `${pluginName}/json`,
      files: ["**/*.json"],
      ignores: sharedIgnorePatterns,
      language: "json/json",
      plugins: {
        json,
        [pluginName]: plugin,
      },
      rules: {
        "weapp2/component-import": "error",
      },
    });
  }

  if (css) {
    configs.push({
      name: `${pluginName}/wxss`,
      files: ["**/*.wxss"],
      ignores: sharedIgnorePatterns,
      language: "css/css",
      plugins: {
        css,
        [pluginName]: plugin,
      },
      rules: {
        "weapp2/wxss-import": "error",
      },
    });
  }

  configs.push({
    name: `${pluginName}/wxml`,
    files: ["**/*.wxml"],
    ignores: sharedIgnorePatterns,
    language: `${pluginName}/wxml`,
    plugins: {
      [pluginName]: plugin,
    },
    rules: {
      "weapp2/wxml-import": "error",
    },
  });

  return configs;
}

function optionalPlugin(id) {
  try {
    const mod = require(id);
    return mod.default || mod;
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}
