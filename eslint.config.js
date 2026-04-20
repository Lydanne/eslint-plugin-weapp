"use strict";

const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["examples/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.mocha,
        ...globals.node,
      },
    },
  },
];
