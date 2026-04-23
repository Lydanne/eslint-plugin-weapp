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
  wxsGlobals,
} = require("./shared-config");
const rules = requireIndex(`${__dirname}/rules`);
const { WXMLLanguage } = require("./languages/wxml-language");

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
      name: `${pluginName}/recommended/js`,
      files: ["**/*.{js,mjs,cjs,ts}"],
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
    {
      name: `${pluginName}/recommended/wxs`,
      files: ["**/*.wxs"],
      ignores: sharedIgnorePatterns,
      languageOptions: {
        ecmaVersion: 5,
        sourceType: "script",
        globals: {
          ...wxsGlobals,
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
plugin.createFlatWeappConfig = createFlatWeappConfig;

module.exports = plugin;

function createFlatWeappConfig(options = {}) {
  const configs = [...plugin.configs["flat/recommended"]];
  const json = options.json || optionalPlugin("@eslint/json");
  const css = options.css || optionalPlugin("@eslint/css");

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
    if (
      error &&
      (error.code === "MODULE_NOT_FOUND" || error.code === "ERR_REQUIRE_ESM")
    ) {
      return null;
    }
    throw error;
  }
}
