"use strict";

/**
 * @fileoverview 基于 app.json 校验 WXSS 文件中的 @import 引用路径：
 *   - `@import "./foo.wxss"` / `@import url("./foo.wxss")` 的目标是否存在
 *   - 跨分包边界（主包 ↛ 分包 / 分包 ↛ 其它分包 / 独立分包 ↛ 外部）
 *
 * 要求：ESLint 9.15+ flat config，且该 .wxss 文件以 `language: "css/css"` 加载
 * （WXSS 语法上是 CSS 超集，@eslint/css 基于 CSSTree 能直接 parse）。
 *
 * 微信小程序原生只识别 `.wxss`；若你的工具链会产生 `.css`（例如 taro 编译输出），
 * 在 `extensions` 选项里自行加上即可。
 */

const path = require("node:path");

const { loadAppJson } = require("../import/app-json");
const { resolveImport, findMatchingAlias } = require("../import/resolver");
const {
  getPackages,
  findPackageOfFile,
  canImport,
} = require("../import/package");
const {
  compileIgnorePatterns,
  shouldIgnoreRequest,
  IGNORE_PATTERNS_SCHEMA,
} = require("../import/state");

// WXSS 默认只尝试 `.wxss`；不要用 JS 的 DEFAULT_EXTENSIONS，避免 resolver
// 在 `@import "./foo"` 时错误命中同名 .js 文件。
const WXSS_EXTENSIONS = [".wxss"];

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        '基于 app.json 校验 WXSS 的 @import 引用路径与分包边界',
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
            },
          },
          ignorePatterns: IGNORE_PATTERNS_SCHEMA,
        },
      },
    ],
    messages: {
      appJsonNotFound:
        '无法读取 app.json: "{{appJsonPath}}" ({{reason}})，请检查 weapp2/wxss-import 规则的 appJsonPath 选项',
      appJsonInvalid: '解析 app.json "{{appJsonPath}}" 失败: {{reason}}',
      notResolved: '@import 路径 "{{request}}" 无法解析到有效文件',
      mainImportSubpackage:
        '主包样式不能 @import 分包 "{{to}}" 中的资源: "{{request}}"',
      crossSubpackage:
        '分包 "{{from}}" 的样式不能 @import 其他分包 "{{to}}" 中的资源: "{{request}}"',
      independentCross:
        '独立分包 "{{from}}" 的样式不能 @import "{{to}}" 中的资源: "{{request}}"',
      aliasNotSupported:
        'WXSS 的 @import 不支持 app.json.resolveAlias（原生只认相对路径 `./..` 或绝对路径 `/`）："{{request}}" 命中别名 "{{alias}}"',
    },
  },

  create(context) {
    let state = null;

    function ensureState(astRoot) {
      if (state !== null) return state;
      state = setupFileState(context, astRoot);
      return state;
    }

    return {
      StyleSheet(node) {
        // 进入根节点时先把 state 建起来；之后 Atrule 访问器里直接复用
        ensureState(node);
      },
      "Atrule[name=/^import$/i]"(node) {
        const s = ensureState(node);
        if (!s || s.skip) return;

        const ref = extractImportRequest(node);
        if (!ref) return;

        checkImport(context, s, ref.node, ref.value);
      },
    };
  },
};

// ---------- ----------

function setupFileState(context, astRoot) {
  const rawOptions = (context.options && context.options[0]) || {};
  const options = {
    appJsonPath: rawOptions.appJsonPath || null,
    miniprogramRootOverride: rawOptions.miniprogramRoot || null,
    extensions: Array.isArray(rawOptions.extensions)
      ? rawOptions.extensions.slice()
      : WXSS_EXTENSIONS,
    checks: {
      pathExists: rawOptions.checks?.pathExists !== false,
      packageBoundary: rawOptions.checks?.packageBoundary !== false,
    },
    ignorePatterns: compileIgnorePatterns(rawOptions),
  };

  const filename =
    context.filename ||
    (typeof context.getFilename === "function" ? context.getFilename() : null);

  if (!filename || filename === "<input>" || filename === "<text>") {
    return { skip: true };
  }
  if (!options.appJsonPath) return { skip: true };

  const appJsonAbs = path.isAbsolute(options.appJsonPath)
    ? options.appJsonPath
    : path.resolve(path.dirname(filename), options.appJsonPath);

  const appJson = loadAppJson(appJsonAbs);
  if (!appJson) return { skip: true };

  if (appJson.error) {
    const isSyntax =
      appJson.error instanceof SyntaxError ||
      String(appJson.error.name) === "SyntaxError";
    context.report({
      loc: astRoot.loc,
      messageId: isSyntax ? "appJsonInvalid" : "appJsonNotFound",
      data: {
        appJsonPath: appJsonAbs,
        reason: appJson.error.message || String(appJson.error),
      },
    });
    return { skip: true };
  }

  const miniprogramRoot = options.miniprogramRootOverride
    ? path.resolve(options.miniprogramRootOverride)
    : appJson.miniprogramRoot;

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

/**
 * 从 `@import` 的 Atrule 节点里取出 request 字符串与定位节点：
 *   - `@import "./a.css";`  → prelude.children[0] 是 String（`.value` 不含引号）
 *   - `@import url("./a.css");` → prelude.children[0] 是 Url，其 `.value` 可以是 String 或直接字符串
 */
function extractImportRequest(atrule) {
  const prelude = atrule.prelude;
  if (!prelude || !Array.isArray(prelude.children) || prelude.children.length === 0) {
    return null;
  }
  const first = prelude.children[0];
  if (!first) return null;

  if (first.type === "String") {
    return { node: first, value: stringOf(first.value) };
  }
  if (first.type === "Url") {
    const inner = first.value;
    if (typeof inner === "string") {
      return { node: first, value: stripQuotes(inner) };
    }
    if (inner && typeof inner === "object" && typeof inner.value === "string") {
      return { node: first, value: stringOf(inner.value) };
    }
  }
  return null;
}

function stringOf(v) {
  // CSSTree 的 String 节点 .value 通常不带引号；保险再剥一次
  return typeof v === "string" ? stripQuotes(v) : "";
}

function stripQuotes(s) {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function checkImport(context, state, node, rawRequest) {
  if (typeof rawRequest !== "string" || rawRequest === "") return;
  if (shouldIgnoreRequest(state.options.ignorePatterns, rawRequest)) return;
  // 跳过协议类地址（远程样式）
  if (
    rawRequest.startsWith("http://") ||
    rawRequest.startsWith("https://") ||
    rawRequest.startsWith("//") ||
    rawRequest.startsWith("data:")
  ) {
    return;
  }

  // 原生 WXSS @import 不支持 resolveAlias；命中别名直接报错
  if (state.aliases.length > 0) {
    const matched = findMatchingAlias(rawRequest, state.aliases);
    if (matched) {
      context.report({
        loc: node.loc,
        messageId: "aliasNotSupported",
        data: { request: rawRequest, alias: matched.prefix },
      });
      return;
    }
  }

  const resolved = resolveImport(rawRequest, {
    currentFile: state.currentFile,
    miniprogramRoot: state.miniprogramRoot,
    extensions: state.options.extensions,
    // 有意不传 aliases —— 原生小程序 WXSS 不认
  });

  if (!resolved) {
    if (state.options.checks.pathExists) {
      context.report({
        loc: node.loc,
        messageId: "notResolved",
        data: { request: rawRequest },
      });
    }
    return;
  }

  if (!state.options.checks.packageBoundary) return;

  const targetPackage = findPackageOfFile(
    resolved,
    state.miniprogramRoot,
    state.packages
  );
  if (!targetPackage) return;

  const result = canImport(state.currentPackage, targetPackage);
  if (!result.allowed) {
    context.report({
      loc: node.loc,
      messageId: result.reason,
      data: { request: rawRequest, ...result.detail },
    });
  }
}
