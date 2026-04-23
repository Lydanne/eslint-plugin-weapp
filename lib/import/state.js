"use strict";

/**
 * @fileoverview 所有 JS-AST 类规则（weapp2/import、weapp2/wx-navigate …）共用的
 * 文件级初始化逻辑：
 *   - 解析 rawOptions → options（projectConfigPath / miniprogramRoot / extensions / checks）
 *   - 加载 & 缓存 app.json
 *   - 判断被 lint 的文件是否在 miniprogramRoot 内
 *   - 定位当前文件所属分包
 *
 * 非 JS AST 的规则（wxss/wxml/json）有各自的 setupFileState，暂不强制统一；
 * 等未来那几个规则也迁移到 language API 后可以再收敛。
 */

const path = require("node:path");

const {
  loadAppJson,
  resolveConfiguredProjectConfigPath,
  resolveAppJsonPathFromNearestProjectConfig,
} = require("./app-json");
const { DEFAULT_EXTENSIONS } = require("./resolver");
const { getPackages, findPackageOfFile } = require("./package");

/**
 * 把 rawOptions.ignorePatterns（字符串数组）编译成 RegExp 数组。
 * 非法正则被静默忽略（最小惊喜：bad config 不让整个规则直接崩）。
 */
function compileIgnorePatterns(rawOptions) {
  const raw = Array.isArray(rawOptions?.ignorePatterns)
    ? rawOptions.ignorePatterns
    : [];
  const compiled = [];
  for (const src of raw) {
    if (typeof src !== "string" || src === "") continue;
    try {
      compiled.push(new RegExp(src));
    } catch {
      // invalid regex source — 忽略
    }
  }
  return compiled;
}

/**
 * 对 request/url 跑一遍 ignorePatterns；命中任一即应跳过。
 */
function shouldIgnoreRequest(ignorePatterns, request) {
  if (!ignorePatterns || ignorePatterns.length === 0) return false;
  if (typeof request !== "string") return false;
  return ignorePatterns.some((re) => re.test(request));
}

/**
 * 所有规则 schema 共用的 ignorePatterns 片段（正则源码字符串数组）。
 */
const IGNORE_PATTERNS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  uniqueItems: true,
};

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
 *     projectConfigPath: string,
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
    projectConfigPath: rawOptions.projectConfigPath || null,
    miniprogramRootOverride: rawOptions.miniprogramRoot || null,
    extensions: Array.isArray(rawOptions.extensions)
      ? rawOptions.extensions.slice()
      : defaultExtensions,
    checks: {
      pathExists: rawOptions.checks?.pathExists !== false,
      packageBoundary: rawOptions.checks?.packageBoundary !== false,
      // 跨分包边界三种 case 的细粒度开关；父开关 packageBoundary 关掉时三个都不生效。
      // 子开关默认均为 true，和现有语义一致。
      mainImportSubpackage:
        rawOptions.checks?.mainImportSubpackage !== false,
      crossSubpackage: rawOptions.checks?.crossSubpackage !== false,
      independentCross: rawOptions.checks?.independentCross !== false,
    },
    // 正则字符串数组 → 编译为 RegExp。命中任一即整条引用静默。
    ignorePatterns: compileIgnorePatterns(rawOptions),
  };

  const filename =
    context.filename ||
    (typeof context.getFilename === "function" ? context.getFilename() : null);

  if (!filename || filename === "<input>" || filename === "<text>") {
    return { skip: true };
  }

  const appJsonResolved = options.projectConfigPath
    ? resolveConfiguredProjectConfigPath(
        options.projectConfigPath,
        path.dirname(filename)
      )
    : resolveAppJsonPathFromNearestProjectConfig(path.dirname(filename));

  if (!appJsonResolved) return { skip: true };
  const appJsonAbs = appJsonResolved.appJsonPath;

  const appJson = appJsonResolved.error
    ? appJsonResolved
    : loadAppJson(appJsonAbs);

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
          appJsonPath: appJson.appJsonPath || appJsonAbs,
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
  compileIgnorePatterns,
  shouldIgnoreRequest,
  IGNORE_PATTERNS_SCHEMA,
};
