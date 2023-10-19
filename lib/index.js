/**
 * @fileoverview a weapp eslint
 * @author eslint-plugin-weapp
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const requireIndex = require("requireindex");

//------------------------------------------------------------------------------
// Plugin Definition
//------------------------------------------------------------------------------


// import all rules in lib/rules
module.exports.rules = requireIndex(__dirname + "/rules");

module.exports.configs = {
  recommended: {
    extends: 'eslint:recommended',
    globals: {
      wx: true,
      App: true,
      Page: true,
      getCurrentPages: true,
      getApp: true,
      Component: true,
      Behavior: true,
      requirePlugin: true,
      requireMiniProgram: true,
      __wxConfig: true,
      define: true,
      globalThis: true,
    },
    env: {
      browser: true,
      node: true,
      es6: true,
      commonjs: true,
    },
    ignorePatterns: ['**/miniprogram_npm/*', '**/@babel/*'],
    overrides: [],
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: ['weapp2'],
    rules: {
      'weapp2/component': 'error',

      // eslint rules
      'no-unused-vars': 'off', // 禁用变量未使用的警告
      'no-empty': 'off', // 禁用空语句块
      'no-async-promise-executor': 'off', // 禁止使用异步函数作为 Promise executor
      'no-useless-catch': 'off', // 禁止不必要的 catch 子句
      'no-useless-escape': 'off', // 禁用不必要的转义字符
      'no-redeclare': 'warn',
      'no-case-declarations': 'warn',
      'no-unreachable': 'warn',
      'no-constant-condition': 'warn',
      'no-mixed-spaces-and-tabs': 'off',
      'no-cond-assign': 'warn',
      'no-control-regex': 'off',
      'no-extra-semi': 'warn',
      'no-dupe-else-if': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-prototype-builtins': 'warn',
      'no-self-assign': 'warn',
      'no-inner-declarations': 'warn',
      'no-dupe-keys': 'warn',
      'no-empty-pattern': 'warn',
      'no-unsafe-negation': 'warn',
      'no-shadow-restricted-names': 'warn',
      'no-unexpected-multiline': 'warn',
      'no-fallthrough': 'warn',
      'no-regex-spaces': 'warn',
      'no-unused-labels': 'warn',
      'no-duplicate-case': 'warn',
      'use-isnan': 'warn',
    }
  }
}



// import processors
module.exports.processors = {
  // add your processors here
};

