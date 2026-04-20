"use strict";

const { oxlintRules, sharedEnv, weappGlobals } = require("./lib/shared-config");

module.exports = {
  categories: {
    correctness: "off",
  },
  env: sharedEnv,
  globals: weappGlobals,
  jsPlugins: ["eslint-plugin-weapp2"],
  rules: oxlintRules,
};
