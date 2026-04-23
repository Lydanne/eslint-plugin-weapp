"use strict";

/**
 * @fileoverview 所有 JS-AST 类规则（weapp2/import、weapp2/wx-navigate …）共用的
 * 文件级初始化逻辑：
 *   - 解析 rawOptions → options（appJsonPath / miniprogramRoot / extensions / checks）
 *   - 加载 & 缓存 app.json
 *   - 判断被 lint 的文件是否在 miniprogramRoot 内
 *   - 定位当前文件所属分包
 *
 * 非 JS AST 的规则（wxss/wxml/json）有各自的 setupFileState，暂不强制统一；
 * 等未来那几个规则也迁移到 language API 后可以再收敛。
 */

const path = require("node:path");

const { loadAppJson } = require("./app-json");
const { DEFAULT_EXTENSIONS } = require("./resolver");
const { getPackages, findPackageOfFile } = require("./package");

/**
 * 构建规则 per-file 状态。
 *
 * @param {import('eslint').Rule.RuleContext} context
 * @param {{ defaultExtensions?: string[] }} [opts]
 * @returns {{ skip: true } | {
 *   skip: false,
 *   appJson: any,
 *   miniprogramRoot: string,
 *   currentFile: string,
 *   currentPackage: any,
 *   packages: any[],
 *   options: {
 *     appJsonPath: string,
 *     miniprogramRootOverride: string | null,
 *     extensions: string[],
 *     checks: { pathExists: boolean, packageBoundary: boolean },
 *   },
 *   aliases: Array<{ kind: 'exact' | 'wildcard', prefix: string, replacement: string }>,
 * }}
 */
function createFileState(context, opts = {}) {
  const defaultExtensions = opts.defaultExtensions || DEFAULT_EXTENSIONS;
  const rawOptions = (context.options && context.options[0]) || {};
  const options = {
    appJsonPath: rawOptions.appJsonPath || null,
    miniprogramRootOverride: rawOptions.miniprogramRoot || null,
    extensions: Array.isArray(rawOptions.extensions)
      ? rawOptions.extensions.slice()
      : defaultExtensions,
    checks: {
      pathExists: rawOptions.checks?.pathExists !== false,
      packageBoundary: rawOptions.checks?.packageBoundary !== false,
    },
  };

  const filename =
    context.filename ||
    (typeof context.getFilename === "function" ? context.getFilename() : null);

  if (!filename || filename === "<input>" || filename === "<text>") {
    return { skip: true };
  }

  if (!options.appJsonPath) {
    // 未配置 appJsonPath → 规则静默跳过，等同于禁用
    return { skip: true };
  }

  const appJsonAbs = path.isAbsolute(options.appJsonPath)
    ? options.appJsonPath
    : path.resolve(path.dirname(filename), options.appJsonPath);

  const appJson = loadAppJson(appJsonAbs);

  if (!appJson) {
    return { skip: true };
  }

  if (appJson.error) {
    // app.json 解析失败：在 Program 级别报错一次，规则后续跳过
    const programNode = getProgramNode(context);
    if (programNode) {
      const isSyntax =
        appJson.error instanceof SyntaxError ||
        String(appJson.error.name) === "SyntaxError";
      context.report({
        node: programNode,
        messageId: isSyntax ? "appJsonInvalid" : "appJsonNotFound",
        data: {
          appJsonPath: appJsonAbs,
          reason: appJson.error.message || String(appJson.error),
        },
      });
    }
    return { skip: true };
  }

  const miniprogramRoot = options.miniprogramRootOverride
    ? path.resolve(options.miniprogramRootOverride)
    : appJson.miniprogramRoot;

  // 被 lint 的文件不在 miniprogramRoot 内 → 跳过
  const relToRoot = path.relative(miniprogramRoot, filename);
  if (!relToRoot || relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return { skip: true };
  }

  const packages = getPackages(appJson.subpackages);
  const currentPackage = findPackageOfFile(filename, miniprogramRoot, packages);

  return {
    skip: false,
    appJson,
    miniprogramRoot,
    currentFile: filename,
    currentPackage,
    packages,
    options,
    aliases: appJson.aliases || [],
  };
}

function getProgramNode(context) {
  try {
    return context.sourceCode?.ast || null;
  } catch {
    return null;
  }
}

/**
 * 从 ESTree 节点读取**字面**字符串（常量折叠到此为止）：
 *   - "abc" / 'abc'
 *   - `abc`（无插值模板字符串）
 *
 * 有表达式的模板字符串会返回 null，由调用方决定是否跳过。
 */
function readStaticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked).join("");
  }
  return null;
}

module.exports = {
  createFileState,
  getProgramNode,
  readStaticString,
};
