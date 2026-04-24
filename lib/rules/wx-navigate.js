"use strict";

/**
 * @fileoverview 基于 app.json 校验 `wx.navigateTo / redirectTo / switchTab / reLaunch`
 *               以及其它可配置的页面跳转 API 的 `url`：
 *   - 目标页面已在 app.json 的 pages / subpackages 中注册
 *   - 相对路径显式带 `./` / `../` 前缀（可选）
 *
 * 注意：**页面跳转不受分包限制**。微信小程序运行时允许
 *   - 主包页面 wx.navigateTo/redirectTo/switchTab/reLaunch 到任意分包页面；
 *   - 任意分包之间互相跳转；
 *   - 独立分包与外部互相跳转（目标包会被按需下载）。
 * 受分包边界约束的是**静态依赖**（JS import/require、usingComponents、
 * .wxss / .wxml 的 import），那些由 `weapp2/import`、`weapp2/component-import`、
 * `weapp2/wxss-import`、`weapp2/wxml-import` 负责；本规则不做跨分包跳转判定。
 *
 * 只识别字面量 `url`；动态拼接（`` `/pages/${foo}/x` ``、模板含表达式）安全跳过。
 *
 * 关于 alias：原生 `wx.navigateTo` 等跳转 API **不理解** `app.json.resolveAlias`，
 * 也不会在运行时做 `@/*` 之类的前缀替换。因此本规则**不展开 alias**：`@/...`、
 * `~utils` 之类写法会被当成非法的绝对/相对路径（默认由 `requireRelativePrefix`
 * 拦下；若关闭该开关则落到 `notResolved`）。与 `weapp2/import` 的 alias 展开
 * 行为**不同**——import 走构建工具，alias 会被替换；跳转走运行时，alias 不生效。
 */

const path = require("node:path");

const { MAIN_PACKAGE } = require("../import/package");
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

  // 不展开 resolveAlias：`wx.*` 跳转 API 在运行时不认 alias，写 `@/...` 就是错的。
  let effective = stripped;

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

  // 页面跳转不受分包限制：微信运行时允许跨主包 / 分包 / 独立分包互跳，目标分包按需下载。
  // 跨分包的静态依赖约束由 `weapp2/import` 等规则负责，本规则在这里结束。
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
