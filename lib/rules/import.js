"use strict";

/**
 * @fileoverview 基于 app.json 检查小程序 JS 文件的 **静态** 引用合法性：
 *   - import / require / import() / export from / .wxs require 的目标是否存在
 *   - 跨分包边界（主包 → 分包、分包 → 分包、独立分包 → 外部）
 *   - .wxs 里的 alias 误用
 *
 * 动态 API（wx.navigateTo / redirectTo / switchTab / reLaunch）跳转的 url 检查
 * 已拆分为独立规则 `weapp2/wx-navigate`。
 */

const {
  resolveImport,
  findMatchingAlias,
  DEFAULT_EXTENSIONS,
} = require("../import/resolver");
const {
  findPackageOfFile,
  canImport,
} = require("../import/package");
const {
  createFileState,
  readStaticString,
  shouldIgnoreRequest,
  IGNORE_PATTERNS_SCHEMA,
} = require("../import/state");

const SKIP_REQUEST_PREFIX = [
  "http://",
  "https://",
  "//",
  "data:",
  "node:",
  "wxfile://",
  "plugin://",
  "plugin-private://",
];

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "基于 app.json 检查小程序的 import/require 与动态跳转是否合法",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          appJsonPath: { type: "string" },
          miniprogramRoot: { type: "string" },
          extensions: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          checks: {
            type: "object",
            additionalProperties: false,
            properties: {
              pathExists: { type: "boolean" },
              packageBoundary: { type: "boolean" },
              mainImportSubpackage: { type: "boolean" },
              crossSubpackage: { type: "boolean" },
              independentCross: { type: "boolean" },
            },
          },
          ignorePatterns: IGNORE_PATTERNS_SCHEMA,
        },
      },
    ],
    messages: {
      appJsonNotFound:
        '无法读取 app.json: "{{appJsonPath}}" ({{reason}})，请检查 weapp2/import 规则的 appJsonPath 选项',
      appJsonInvalid: '解析 app.json "{{appJsonPath}}" 失败: {{reason}}',
      notResolved: '引用路径 "{{request}}" 无法解析到有效文件',
      mainImportSubpackage:
        '主包文件不能引用分包 "{{to}}" 中的资源: "{{request}}"',
      crossSubpackage:
        '分包 "{{from}}" 不能引用其他分包 "{{to}}" 中的资源: "{{request}}"',
      independentCross:
        '独立分包 "{{from}}" 不能引用 "{{to}}" 中的资源: "{{request}}"',
      aliasNotSupportedInWxs:
        'WXS 文件的 require 不支持 app.json.resolveAlias（原生小程序只认相对路径）："{{request}}" 命中别名 "{{alias}}"',
    },
  },

  createOnce(context) {
    // createOnce 阶段 context.options/filename 均不可用（compat 层强制置空），
    // 因此把所有 per-file 状态的构建推迟到 before() 钩子里完成。
    /** @type {null | { skip: boolean, appJson: any, miniprogramRoot: string, currentFile: string, currentPackage: any, packages: any[], options: object }} */
    let state = null;

    return {
      before() {
        state = createFileState(context, { defaultExtensions: DEFAULT_EXTENSIONS });
      },
      after() {
        state = null;
      },

      ImportDeclaration(node) {
        if (node.source && typeof node.source.value === "string") {
          checkStatic(context, state, node.source, node.source.value);
        }
      },
      ExportAllDeclaration(node) {
        if (node.source && typeof node.source.value === "string") {
          checkStatic(context, state, node.source, node.source.value);
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source && typeof node.source.value === "string") {
          checkStatic(context, state, node.source, node.source.value);
        }
      },
      ImportExpression(node) {
        const literal = readStaticString(node.source);
        if (literal !== null) {
          checkStatic(context, state, node.source, literal);
        }
      },
      CallExpression(node) {
        // Pattern 1: require('x') / require('x', cb, errCb?)
        //   多参形态是微信「分包异步化」的 callback 风格，合法跨分包加载。
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length >= 1
        ) {
          const arg = node.arguments[0];
          const literal = readStaticString(arg);
          if (literal !== null) {
            const isAsync = node.arguments.length >= 2;
            checkStatic(context, state, arg, literal, { isAsync });
          }
          return;
        }

        // Pattern 2: require.async('x')
        //   微信「分包异步化」的 Promise 风格，合法跨分包加载。
        if (
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "require" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "async" &&
          node.arguments.length >= 1
        ) {
          const arg = node.arguments[0];
          const literal = readStaticString(arg);
          if (literal !== null) {
            checkStatic(context, state, arg, literal, { isAsync: true });
          }
        }
      },
    };
  },
};

// -------- 内部实现 --------

function shouldSkipRequest(request) {
  if (typeof request !== "string" || request === "") return true;
  for (const prefix of SKIP_REQUEST_PREFIX) {
    if (request.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * @param {object} opts
 * @param {boolean} [opts.isAsync] 是否是「分包异步化」形式的 require：
 *   - `require(path, cb, errCb?)`
 *   - `require.async(path)`
 *   这两种形式是微信官方合法的跨分包加载机制，应跳过 packageBoundary 校验。
 *   参考：https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/async.html
 */
function checkStatic(context, state, node, request, opts = {}) {
  if (!state || state.skip) return;
  if (shouldSkipRequest(request)) return;
  if (shouldIgnoreRequest(state.options.ignorePatterns, request)) return;

  // .wxs 在原生小程序里只支持相对路径，不走 resolveAlias；命中则直接报错。
  const isWxs = typeof state.currentFile === "string" && state.currentFile.endsWith(".wxs");
  if (isWxs && state.aliases.length > 0) {
    const matched = findMatchingAlias(request, state.aliases);
    if (matched) {
      context.report({
        node,
        messageId: "aliasNotSupportedInWxs",
        data: { request, alias: matched.prefix },
      });
      return;
    }
  }

  const resolved = resolveImport(request, {
    currentFile: state.currentFile,
    miniprogramRoot: state.miniprogramRoot,
    extensions: state.options.extensions,
    aliases: isWxs ? undefined : state.aliases,
  });

  if (!resolved) {
    if (state.options.checks.pathExists) {
      context.report({
        node,
        messageId: "notResolved",
        data: { request },
      });
    }
    return;
  }

  if (!state.options.checks.packageBoundary) return;

  // 分包异步化：官方合法跨分包加载机制，路径存在性校验之后静默通过。
  if (opts.isAsync) return;

  const targetPackage = findPackageOfFile(
    resolved,
    state.miniprogramRoot,
    state.packages
  );
  if (!targetPackage) return; // 解析到 miniprogramRoot 之外的文件（例如 miniprogram_npm 外部）

  const result = canImport(state.currentPackage, targetPackage);
  if (!result.allowed) {
    // 细粒度子开关 gate：关掉对应 reason 后静默跳过，方便在特殊项目结构里按 case 放行。
    if (state.options.checks[result.reason] === false) return;
    context.report({
      node,
      messageId: result.reason,
      data: { request, ...result.detail },
    });
  }
}

