"use strict";

/**
 * @fileoverview 基于 app.json 校验 `wx.navigateTo / redirectTo / switchTab / reLaunch`
 *               以及其它可配置的页面跳转 API 的 `url`：
 *   - 目标页面已在 app.json 注册
 *   - 不违反跨分包边界（主包 → 分包、分包 → 分包、独立分包 → 外部）
 *
 * 只识别字面量 `url`；动态拼接（`` `/pages/${foo}/x` ``、模板含表达式）安全跳过。
 *
 * 关于 alias：原生 `wx.navigateTo` 不理解 `app.json.resolveAlias`，但在某些构建
 * 工具链（taro / 自研打包）里会做编译期替换。插件保留"先展开 alias 再校验"
 * 的行为，与 `weapp2/import` 的 alias 语义一致；如果你不希望 alias 被接受，
 * 直接不要在 `resolveAlias` 里配置 `@/*` 之类的通配即可。
 */

const path = require("node:path");

const { applyAliases } = require("../import/resolver");
const {
  canImport,
  MAIN_PACKAGE,
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
          projectConfigPath: { type: "string" },
          miniprogramRoot: { type: "string" },
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
          requireRelativePrefix: { type: "boolean" },
          ignorePatterns: IGNORE_PATTERNS_SCHEMA,
        },
      },
    ],
    messages: {
      appJsonNotFound:
        '无法读取小程序配置: "{{appJsonPath}}" ({{reason}})，请检查 weapp2/wx-navigate 规则的 projectConfigPath 选项',
      appJsonInvalid: '解析小程序配置 "{{appJsonPath}}" 失败: {{reason}}',
      notResolved: '跳转 url "{{request}}" 未在 app.json 的 pages/subpackages 中注册',
      mainImportSubpackage:
        '主包页面不能通过 {{api}} 跳转到分包 "{{to}}" 的页面: "{{request}}"',
      crossSubpackage:
        '分包 "{{from}}" 不能通过 {{api}} 跳转到分包 "{{to}}" 的页面: "{{request}}"',
      independentCross:
        '独立分包 "{{from}}" 不能通过 {{api}} 跳转到 "{{to}}" 的页面: "{{request}}"',
      relativePrefixRequired:
        '跳转 url "{{request}}" 必须显式使用 "./" 或 "../" 相对路径，或使用 "/" 绝对路径',
    },
  },

  create(context) {
    const state = createFileState(context);
    if (!state || state.skip) return {};
    const registeredPages = buildRegisteredPages(state.appJson);

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
        checkDynamic(context, state, registeredPages, dynamic);
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

function checkDynamic(context, state, registeredPages, dynamic) {
  const raw = dynamic.url;
  if (shouldIgnoreRequest(state.options.ignorePatterns, raw)) return;
  // 去除 query / hash
  const stripped = raw.split(/[?#]/)[0];
  if (!stripped) return;
  if (shouldSkipUrl(stripped)) return;

  const aliased = applyAliases(stripped, state.aliases);
  let effective = aliased !== null ? aliased : stripped;

  if (!hasNavigatePathPrefix(effective)) {
    if (state.options.requireRelativePrefix) {
      context.report({
        node: dynamic.node,
        messageId: "relativePrefixRequired",
        data: { request: raw },
      });
      return;
    }
    effective = "./" + effective;
  }

  const source = findCurrentRegisteredPage(state, registeredPages);
  if (
    !source &&
    (effective.startsWith("./") || effective.startsWith("../"))
  ) {
    return;
  }

  const targetPage = resolvePagePath(effective, state, source);
  const target = targetPage ? registeredPages.get(targetPage) : null;

  if (!target) {
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
  if (!source) return;

  const result = canImport(source.package, target.package);
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

function shouldSkipUrl(url) {
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("//") ||
    url.startsWith("data:") ||
    url.startsWith("plugin://")
  );
}

function hasNavigatePathPrefix(request) {
  return (
    request.startsWith("/") ||
    request.startsWith("./") ||
    request.startsWith("../")
  );
}

function buildRegisteredPages(appJson) {
  const pages = new Map();

  for (const page of appJson.pages || []) {
    addRegisteredPage(pages, page, MAIN_PACKAGE);
  }

  for (const subpackage of appJson.subpackages || []) {
    const root = stripSlashes(subpackage.root);
    for (const page of subpackage.pages || []) {
      addRegisteredPage(
        pages,
        path.posix.join(root, stripSlashes(page)),
        subpackage
      );
    }
  }

  return pages;
}

function addRegisteredPage(pages, page, pkg) {
  const normalized = normalizePageStem(page);
  if (!normalized) return;
  pages.set(normalized, { page: normalized, package: pkg });
}

function findCurrentRegisteredPage(state, registeredPages) {
  const currentPage = normalizePageStem(
    path.relative(state.miniprogramRoot, state.currentFile)
  );
  return currentPage ? registeredPages.get(currentPage) || null : null;
}

function resolvePagePath(request, state, source) {
  if (request.startsWith("/")) {
    return normalizePageStem(request);
  }

  const currentPage = source?.page ||
    toPosix(path.relative(state.miniprogramRoot, state.currentFile));
  const currentDir = path.posix.dirname(currentPage);
  return normalizePageStem(
    path.posix.normalize(path.posix.join(currentDir, request))
  );
}

function normalizePageStem(value) {
  if (typeof value !== "string" || value === "") return null;
  const normalized = stripSlashes(toPosix(value));
  if (!normalized || normalized.startsWith("..")) return null;
  return stripPageExtension(normalized);
}

function stripPageExtension(value) {
  return value.replace(/\.(?:js|ts|wxml|json|wxss)$/i, "");
}

function stripSlashes(value) {
  return String(value).replace(/^[/\\]+|[/\\]+$/g, "");
}

function toPosix(value) {
  return String(value).replace(/\\/g, "/");
}
