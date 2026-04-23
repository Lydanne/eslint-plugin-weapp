"use strict";

/**
 * @fileoverview 基于 app.json 校验 WXML 模板中 `<import>` / `<include>` / `<wxs>` 的 src 引用。
 *
 * 要求：在 flat config 里给 `**\/*.wxml` 设置 `language: "weapp2/wxml"` 并启用此规则。
 *
 * 动态绑定 src="{{foo}}" 会被解析器跳过，规则拿不到 string 字面量即安全跳过。
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

const WXML_EXTENSIONS = [".wxml"];
const WXS_EXTENSIONS = [".wxs"];

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "基于 app.json 校验 WXML 中 <import>/<include>/<wxs> 的 src 路径与分包边界",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          appJsonPath: { type: "string" },
          miniprogramRoot: { type: "string" },
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
        '无法读取 app.json: "{{appJsonPath}}" ({{reason}})，请检查 weapp2/wxml-import 规则的 appJsonPath 选项',
      appJsonInvalid: '解析 app.json "{{appJsonPath}}" 失败: {{reason}}',
      notResolved: 'WXML {{tag}} 的 src "{{request}}" 无法解析到有效文件',
      mainImportSubpackage:
        '主包 WXML 不能引用分包 "{{to}}" 中的 {{tag}} 资源: "{{request}}"',
      crossSubpackage:
        '分包 "{{from}}" 的 WXML 不能引用其他分包 "{{to}}" 中的 {{tag}} 资源: "{{request}}"',
      independentCross:
        '独立分包 "{{from}}" 的 WXML 不能引用 "{{to}}" 中的 {{tag}} 资源: "{{request}}"',
      aliasNotSupported:
        'WXML {{tag}} 的 src 不支持 app.json.resolveAlias（原生只认相对路径 `./..` 或绝对路径 `/`）："{{request}}" 命中别名 "{{alias}}"',
    },
  },

  create(context) {
    let state = null;

    function ensureState(root) {
      if (state !== null) return state;
      state = setupFileState(context, root);
      return state;
    }

    return {
      Program(node) {
        ensureState(node);
      },
      SrcAttribute(node) {
        const s = state;
        if (!s || s.skip) return;

        const extensions = node.tag === "wxs" ? WXS_EXTENSIONS : WXML_EXTENSIONS;
        checkRequest(context, s, node, node.value, extensions, node.tag);
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
        appJsonPath: appJson.appJsonPath || appJsonAbs,
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

function checkRequest(context, state, node, rawRequest, extensions, tag) {
  if (typeof rawRequest !== "string" || rawRequest === "") return;
  if (shouldIgnoreRequest(state.options.ignorePatterns, rawRequest)) return;

  // 跳过协议类（一般 WXML 不会这么写，但稳妥）
  if (
    rawRequest.startsWith("http://") ||
    rawRequest.startsWith("https://") ||
    rawRequest.startsWith("//") ||
    rawRequest.startsWith("data:")
  ) {
    return;
  }

  // 原生 WXML 的 <import>/<include>/<wxs> src 都不支持 resolveAlias；命中即报错
  if (state.aliases.length > 0) {
    const matched = findMatchingAlias(rawRequest, state.aliases);
    if (matched) {
      context.report({
        loc: node.loc,
        messageId: "aliasNotSupported",
        data: {
          request: rawRequest,
          tag: "<" + tag + ">",
          alias: matched.prefix,
        },
      });
      return;
    }
  }

  const resolved = resolveImport(rawRequest, {
    currentFile: state.currentFile,
    miniprogramRoot: state.miniprogramRoot,
    extensions,
    // 有意不传 aliases —— 原生 WXML 不认
  });

  if (!resolved) {
    if (state.options.checks.pathExists) {
      context.report({
        loc: node.loc,
        messageId: "notResolved",
        data: { request: rawRequest, tag: "<" + tag + ">" },
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
      data: {
        request: rawRequest,
        tag: "<" + tag + ">",
        ...result.detail,
      },
    });
  }
}
