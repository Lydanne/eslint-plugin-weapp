"use strict";

/**
 * @fileoverview 基于 app.json 检查小程序 JS 文件的引用合法性：
 *   - 静态 import / require / import() / export from 的目标是否存在
 *   - 跨分包边界（主包 → 分包、分包 → 分包、独立分包 → 外部）
 *   - wx.navigateTo / redirectTo / switchTab / reLaunch 等动态跳转 url
 */

const path = require("node:path");

const { loadAppJson } = require("../import/app-json");
const {
  resolveImport,
  applyAliases,
  DEFAULT_EXTENSIONS,
} = require("../import/resolver");
const {
  getPackages,
  findPackageOfFile,
  canImport,
} = require("../import/package");

const DYNAMIC_WX_METHODS = new Set([
  "navigateTo",
  "redirectTo",
  "switchTab",
  "reLaunch",
]);

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
              dynamic: { type: "boolean" },
            },
          },
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
      dynamicNotResolved:
        '动态跳转 url "{{request}}" 无法解析到小程序页面',
      dynamicMainImportSubpackage:
        '主包页面不能通过 {{api}} 跳转到分包 "{{to}}" 的页面: "{{request}}"',
      dynamicCrossSubpackage:
        '分包 "{{from}}" 不能通过 {{api}} 跳转到分包 "{{to}}" 的页面: "{{request}}"',
      dynamicIndependentCross:
        '独立分包 "{{from}}" 不能通过 {{api}} 跳转到 "{{to}}" 的页面: "{{request}}"',
    },
  },

  createOnce(context) {
    // createOnce 阶段 context.options/filename 均不可用（compat 层强制置空），
    // 因此把所有 per-file 状态的构建推迟到 before() 钩子里完成。
    /** @type {null | { skip: boolean, appJson: any, miniprogramRoot: string, currentFile: string, currentPackage: any, packages: any[], options: object }} */
    let state = null;

    return {
      before() {
        state = setupFileState(context);
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
        // require('x')
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length >= 1
        ) {
          const arg = node.arguments[0];
          const literal = readStaticString(arg);
          if (literal !== null) {
            checkStatic(context, state, arg, literal);
          }
          return;
        }

        // wx.navigateTo({ url }) / redirectTo / switchTab / reLaunch
        const dynamic = readWxNavigateCall(node);
        if (dynamic) {
          checkDynamic(context, state, dynamic);
        }
      },
    };
  },
};

// -------- 内部实现 --------

function setupFileState(context) {
  const rawOptions = (context.options && context.options[0]) || {};
  const options = {
    appJsonPath: rawOptions.appJsonPath || null,
    miniprogramRootOverride: rawOptions.miniprogramRoot || null,
    extensions: Array.isArray(rawOptions.extensions)
      ? rawOptions.extensions.slice()
      : DEFAULT_EXTENSIONS,
    checks: {
      pathExists: rawOptions.checks?.pathExists !== false,
      packageBoundary: rawOptions.checks?.packageBoundary !== false,
      dynamic: rawOptions.checks?.dynamic !== false,
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
    // 每文件只提示一次，但 ESLint 是 per-file，天然一次
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

function shouldSkipRequest(request) {
  if (typeof request !== "string" || request === "") return true;
  for (const prefix of SKIP_REQUEST_PREFIX) {
    if (request.startsWith(prefix)) return true;
  }
  return false;
}

function checkStatic(context, state, node, request) {
  if (!state || state.skip) return;
  if (shouldSkipRequest(request)) return;

  const resolved = resolveImport(request, {
    currentFile: state.currentFile,
    miniprogramRoot: state.miniprogramRoot,
    extensions: state.options.extensions,
    aliases: state.aliases,
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

  const targetPackage = findPackageOfFile(
    resolved,
    state.miniprogramRoot,
    state.packages
  );
  if (!targetPackage) return; // 解析到 miniprogramRoot 之外的文件（例如 miniprogram_npm 外部）

  const result = canImport(state.currentPackage, targetPackage);
  if (!result.allowed) {
    context.report({
      node,
      messageId: result.reason,
      data: { request, ...result.detail },
    });
  }
}

function readWxNavigateCall(node) {
  if (node.callee.type !== "MemberExpression") return null;
  const object = node.callee.object;
  const property = node.callee.property;
  if (node.callee.computed) return null;
  if (
    !object ||
    object.type !== "Identifier" ||
    object.name !== "wx" ||
    !property ||
    property.type !== "Identifier" ||
    !DYNAMIC_WX_METHODS.has(property.name)
  ) {
    return null;
  }
  if (node.arguments.length === 0) return null;

  const arg = node.arguments[0];
  if (!arg || arg.type !== "ObjectExpression") return null;

  for (const prop of arg.properties) {
    if (
      prop.type !== "Property" ||
      prop.computed ||
      !prop.key ||
      (prop.key.type === "Identifier" && prop.key.name !== "url") ||
      (prop.key.type === "Literal" && prop.key.value !== "url")
    ) {
      continue;
    }
    const url = readStaticString(prop.value);
    if (url === null) return null; // 动态 url 暂不校验
    return { api: property.name, url, node: prop.value };
  }
  return null;
}

function checkDynamic(context, state, dynamic) {
  if (!state || state.skip || !state.options.checks.dynamic) return;

  const raw = dynamic.url;
  // 去除 query/hash
  const stripped = raw.split(/[?#]/)[0];
  if (!stripped) return;

  // 先做一次 alias 展开再判前缀；否则 `@/pages/...` 会在前缀 gate 被直接跳过。
  // 命中别名时用展开后的结果做前缀判断，本地解析仍由 resolveImport 内部再做一次。
  const aliased = applyAliases(stripped, state.aliases);
  const forPrefixCheck = aliased !== null ? aliased : stripped;

  // 动态 url 只校验小程序绝对路径（/ 开头）与相对路径；其余（裸名、协议）跳过
  if (
    !forPrefixCheck.startsWith("/") &&
    !forPrefixCheck.startsWith("./") &&
    !forPrefixCheck.startsWith("../")
  ) {
    return;
  }

  const resolved = resolveImport(stripped, {
    currentFile: state.currentFile,
    miniprogramRoot: state.miniprogramRoot,
    extensions: state.options.extensions,
    aliases: state.aliases,
  });

  if (!resolved) {
    if (state.options.checks.pathExists) {
      context.report({
        node: dynamic.node,
        messageId: "dynamicNotResolved",
        data: { request: raw },
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
    const dynamicMessageId =
      result.reason === "mainImportSubpackage"
        ? "dynamicMainImportSubpackage"
        : result.reason === "crossSubpackage"
          ? "dynamicCrossSubpackage"
          : "dynamicIndependentCross";
    context.report({
      node: dynamic.node,
      messageId: dynamicMessageId,
      data: { request: raw, api: `wx.${dynamic.api}`, ...result.detail },
    });
  }
}
