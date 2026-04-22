"use strict";

const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "examples/**",
      "fixtures/**",
      "node_modules/**",
      "tests/fixtures/**",
    ],
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
