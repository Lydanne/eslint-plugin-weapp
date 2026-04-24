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
 *
 * 关于被识别的"调用形态"：原生 `wx.navigateTo / redirectTo / switchTab / reLaunch`
 * 始终内置校验；其它自定义包装通过 `callees` 选项追加，支持以下四种形态：
 *   1. 模块对象： router.navigateTo({ url })
 *   2. 裸函数：   navigateTo({ url })
 *   3. 实例方法： this.$router.push({ url })
 *   4. 位置参数： router.go('/pages/x/x')
 * `callees` 每项是一个 dot-path 字符串（精确匹配调用链，`this` 作为特殊首段）
 * 或对象 `{ match, url: { key? | arg? } }`；具体见 docs。
 */

const path = require("node:path");

const { MAIN_PACKAGE } = require("../import/package");
const {
  createFileState,
  readStaticString,
  shouldIgnoreRequest,
  IGNORE_PATTERNS_SCHEMA,
} = require("../import/state");

// 始终内置的原生 wx.* 跳转 API matchers；用户的 `callees` 会在此基础上并集叠加。
const DEFAULT_CALLEES = [
  "wx.navigateTo",
  "wx.redirectTo",
  "wx.switchTab",
  "wx.reLaunch",
];

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
          callees: {
            type: "array",
            items: {
              oneOf: [
                { type: "string" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["match"],
                  properties: {
                    match: { type: "string" },
                    url: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        key: { type: "string" },
                        arg: { type: "integer", minimum: 0 },
                      },
                    },
                  },
                },
              ],
            },
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
    const matchers = compileMatchers(rawOptions);
    if (matchers.length === 0) return {};

    return {
      CallExpression(node) {
        const dynamic = readNavigateCall(node, matchers);
        if (!dynamic) return;
        checkDynamic(context, state, registeredPages, dynamic);
      },
    };
  },
};

// -------- 内部实现 --------

/**
 * 把内置默认和 rawOptions.callees 归一化成 matcher 数组。
 * 每个 matcher 的形状：
 *   { path: string[], url: { kind: 'key', key: string } | { kind: 'arg', index: number } }
 * `path` 对应调用链的各段（`this` 作为特殊首段）；精确匹配。
 */
function compileMatchers(rawOptions) {
  const seen = new Set();
  const matchers = [];

  const push = (rawPath, url) => {
    const path = parseDotPath(rawPath);
    if (!path) return;
    const key = path.join(".") + "|" + JSON.stringify(url);
    if (seen.has(key)) return;
    seen.add(key);
    matchers.push({ path, url });
  };

  // 默认 `wx.*` 跳转 API 始终校验
  for (const name of DEFAULT_CALLEES) {
    push(name, { kind: "key", key: "url" });
  }

  // 用户自定义包装：并集叠加
  if (Array.isArray(rawOptions.callees)) {
    for (const entry of rawOptions.callees) {
      if (typeof entry === "string") {
        push(entry, { kind: "key", key: "url" });
      } else if (entry && typeof entry === "object" && typeof entry.match === "string") {
        const url = normalizeUrlSource(entry.url);
        push(entry.match, url);
      }
    }
  }

  return matchers;
}

function normalizeUrlSource(raw) {
  if (raw && typeof raw === "object") {
    if (typeof raw.arg === "number" && raw.arg >= 0) {
      return { kind: "arg", index: raw.arg };
    }
    if (typeof raw.key === "string" && raw.key !== "") {
      return { kind: "key", key: raw.key };
    }
  }
  return { kind: "key", key: "url" };
}

function parseDotPath(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const segments = trimmed.split(".");
  for (const seg of segments) {
    if (!seg) return null;
  }
  return segments;
}

function readNavigateCall(node, matchers) {
  const callPath = extractCalleePath(node.callee);
  if (!callPath) return null;

  for (const matcher of matchers) {
    if (!pathsEqual(callPath, matcher.path)) continue;
    const located = readUrlFromArgs(node, matcher.url);
    // located === undefined → 形态不对（比如期望对象参数但给了字符串）；换下一 matcher 继续
    if (located === undefined) continue;
    // located === null → 形态对但 url 是动态的，安全跳过整次调用
    if (located === null) return null;
    return {
      callPath,
      url: located.url,
      node: located.node,
    };
  }
  return null;
}

/**
 * 读取 CallExpression 的调用链：
 *   wx.navigateTo         → ["wx", "navigateTo"]
 *   navigateTo            → ["navigateTo"]
 *   this.$router.push     → ["this", "$router", "push"]
 *   a["b"].c              → ["a", "b", "c"]（computed 只接受字符串 Literal）
 *   a[expr].c             → null
 */
function extractCalleePath(node) {
  if (!node) return null;
  if (node.type === "Identifier") return [node.name];
  if (node.type === "ThisExpression") return ["this"];
  if (node.type === "MemberExpression") {
    const objectPath = extractCalleePath(node.object);
    if (!objectPath) return null;
    const prop = node.property;
    let name = null;
    if (!node.computed && prop && prop.type === "Identifier") {
      name = prop.name;
    } else if (
      node.computed &&
      prop &&
      prop.type === "Literal" &&
      typeof prop.value === "string"
    ) {
      name = prop.value;
    }
    if (name === null) return null;
    return objectPath.concat(name);
  }
  return null;
}

function pathsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 根据 matcher.url 从 CallExpression 参数里读 url。
 *   - 返回 { url, node } 表示拿到了字面量 url；
 *   - 返回 null 表示形态匹配但 url 动态（整次调用应静默跳过）；
 *   - 返回 undefined 表示形态不匹配（应让调用方尝试下一个 matcher）。
 */
function readUrlFromArgs(node, urlSource) {
  if (urlSource.kind === "arg") {
    const arg = node.arguments[urlSource.index];
    if (!arg) return undefined;
    // 位置参数模式下，若该参数是对象字面量说明形态不对（应该是字符串），放弃
    if (arg.type === "ObjectExpression") return undefined;
    const url = readStaticString(arg);
    if (url === null) return null; // 动态 → 跳过整条
    return { url, node: arg };
  }

  // kind === 'key'
  const arg = node.arguments[0];
  if (!arg || arg.type !== "ObjectExpression") return undefined;

  for (const prop of arg.properties) {
    if (prop.type !== "Property" || prop.computed || !prop.key) continue;
    const keyName =
      prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal" && typeof prop.key.value === "string"
        ? prop.key.value
        : null;
    if (keyName !== urlSource.key) continue;
    const url = readStaticString(prop.value);
    if (url === null) return null; // 动态 url → 跳过
    return { url, node: prop.value };
  }
  return undefined; // 对象里没有这个 key → 形态不匹配
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
