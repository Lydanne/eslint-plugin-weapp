"use strict";

/**
 * @fileoverview 基于 app.json 校验 `wx.navigateTo / redirectTo / switchTab / reLaunch`
 *               以及其它可配置的页面跳转 API 的 `url`：
 *   - 目标页面存在
 *   - 不违反跨分包边界（主包 → 分包、分包 → 分包、独立分包 → 外部）
 *
 * 只识别字面量 `url`；动态拼接（`` `/pages/${foo}/x` ``、模板含表达式）安全跳过。
 *
 * 关于 alias：原生 `wx.navigateTo` 不理解 `app.json.resolveAlias`，但在某些构建
 * 工具链（taro / 自研打包）里会做编译期替换。插件保留"先展开 alias 再校验"
 * 的行为，与 `weapp2/import` 的 alias 语义一致；如果你不希望 alias 被接受，
 * 直接不要在 `resolveAlias` 里配置 `@/*` 之类的通配即可。
 */

const {
  resolveImport,
  applyAliases,
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

const DEFAULT_APIS = ["navigateTo", "redirectTo", "switchTab", "reLaunch"];

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "基于 app.json 校验 wx.navigateTo / redirectTo / switchTab / reLaunch 等跳转 API 的 url 是否合法",
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
          apis: {
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
        '无法读取 app.json: "{{appJsonPath}}" ({{reason}})，请检查 weapp2/wx-navigate 规则的 appJsonPath 选项',
      appJsonInvalid: '解析 app.json "{{appJsonPath}}" 失败: {{reason}}',
      notResolved: '跳转 url "{{request}}" 无法解析到小程序页面',
      mainImportSubpackage:
        '主包页面不能通过 {{api}} 跳转到分包 "{{to}}" 的页面: "{{request}}"',
      crossSubpackage:
        '分包 "{{from}}" 不能通过 {{api}} 跳转到分包 "{{to}}" 的页面: "{{request}}"',
      independentCross:
        '独立分包 "{{from}}" 不能通过 {{api}} 跳转到 "{{to}}" 的页面: "{{request}}"',
    },
  },

  create(context) {
    const state = createFileState(context);
    if (!state || state.skip) return {};

    const rawOptions = (context.options && context.options[0]) || {};
    const apis = new Set(
      Array.isArray(rawOptions.apis) && rawOptions.apis.length > 0
        ? rawOptions.apis
        : DEFAULT_APIS
    );

    return {
      CallExpression(node) {
        const dynamic = readWxNavigateCall(node, apis);
        if (!dynamic) return;
        checkDynamic(context, state, dynamic);
      },
    };
  },
};

// -------- 内部实现 --------

function readWxNavigateCall(node, apis) {
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
    !apis.has(property.name)
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
    if (url === null) return null; // 动态 url 跳过
    return { api: property.name, url, node: prop.value };
  }
  return null;
}

function checkDynamic(context, state, dynamic) {
  const raw = dynamic.url;
  if (shouldIgnoreRequest(state.options.ignorePatterns, raw)) return;
  // 去除 query / hash
  const stripped = raw.split(/[?#]/)[0];
  if (!stripped) return;

  // 先尝试展开 alias；展开结果仅用于前缀类型判断，真正解析仍由 resolveImport 做。
  const aliased = applyAliases(stripped, state.aliases);
  const forPrefixCheck = aliased !== null ? aliased : stripped;

  // 仅校验小程序绝对路径（`/` 开头）与相对路径；裸名 / 协议不在意
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
        messageId: "notResolved",
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
    // 细粒度子开关 gate：关掉对应 reason 后静默跳过。
    if (state.options.checks[result.reason] === false) return;
    context.report({
      node: dynamic.node,
      messageId: result.reason,
      data: { request: raw, api: `wx.${dynamic.api}`, ...result.detail },
    });
  }
}
