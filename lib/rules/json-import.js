"use strict";

/**
 * @fileoverview 基于 app.json 校验小程序 JSON 配置文件（app.json / 页面/组件 .json）中的路径字段：
 *   - `usingComponents` / `componentGenerics.*.default`（等价于 JS import：走 alias）
 *   - `pages`、`subpackages[*].pages` / `subPackages[*].pages`（无扩展名 stem）
 *   - `tabBar.list[*].iconPath` / `selectedIconPath`
 *   - `themeLocation` / `sitemapLocation`
 *
 * 要求：ESLint 9+ 的 flat config，并且该 JSON 文件以 `language: "json/json"`（或 jsonc/json5）加载。
 * AST 提供方：@eslint/json（基于 momoa）。
 */

const path = require("node:path");

const {
  loadAppJson,
  resolveConfiguredProjectConfigPath,
  resolveAppJsonPathFromNearestProjectConfig,
} = require("../import/app-json");
const {
  resolveImport,
  findMatchingAlias,
  DEFAULT_EXTENSIONS,
} = require("../import/resolver");
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

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "基于 app.json 校验小程序 JSON 配置文件中的路径（usingComponents / pages / tabBar 等）",
    },
    // 与 weapp2/import 保持一致的 option schema
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          projectConfigPath: { type: "string" },
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
        '无法读取小程序配置: "{{appJsonPath}}" ({{reason}})，请检查 weapp2/json-import 规则的 projectConfigPath 选项',
      appJsonInvalid: '解析小程序配置 "{{appJsonPath}}" 失败: {{reason}}',
      notResolved: 'JSON 路径 "{{request}}" 无法解析到有效文件',
      mainImportSubpackage:
        '主包文件的 JSON 字段不能引用分包 "{{to}}" 中的资源: "{{request}}"',
      crossSubpackage:
        '分包 "{{from}}" 的 JSON 字段不能引用其他分包 "{{to}}" 中的资源: "{{request}}"',
      independentCross:
        '独立分包 "{{from}}" 的 JSON 字段不能引用 "{{to}}" 中的资源: "{{request}}"',
      aliasNotSupported:
        '小程序 JSON 配置文件不支持 app.json.resolveAlias（原生只认相对路径 `./..` 或绝对路径 `/`）："{{request}}" 命中别名 "{{alias}}"',
    },
  },

  create(context) {
    let state = null;

    return {
      Document(node) {
        // 每个 JSON 文件进入时懒加载一次 state（含 app.json）。
        if (state === null) state = setupFileState(context, node);
        if (!state || state.skip) return;

        const root = node.body;
        if (!root || root.type !== "Object") return;

        walkRoot(context, state, root);
      },
    };
  },
};

// ---------- 状态构建 ----------

function setupFileState(context, documentNode) {
  const rawOptions = (context.options && context.options[0]) || {};
  const options = {
    projectConfigPath: rawOptions.projectConfigPath || null,
    miniprogramRootOverride: rawOptions.miniprogramRoot || null,
    extensions: Array.isArray(rawOptions.extensions)
      ? rawOptions.extensions.slice()
      : DEFAULT_EXTENSIONS,
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
  if (!appJson) return { skip: true };

  if (appJson.error) {
    const isSyntax =
      appJson.error instanceof SyntaxError ||
      String(appJson.error.name) === "SyntaxError";
    context.report({
      loc: documentNode.loc,
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

// ---------- 顶层字段遍历 ----------

function walkRoot(context, state, rootObject) {
  for (const member of rootObject.members) {
    const key = memberKey(member);
    const value = member.value;
    if (!value) continue;

    switch (key) {
      case "usingComponents":
        visitUsingComponents(context, state, value);
        break;
      case "componentGenerics":
        visitComponentGenerics(context, state, value);
        break;
      case "pages":
        visitStemArray(context, state, value, "");
        break;
      case "subpackages":
      case "subPackages":
        visitSubpackages(context, state, value);
        break;
      case "tabBar":
        visitTabBar(context, state, value);
        break;
      case "themeLocation":
      case "sitemapLocation":
        visitAbsFull(context, state, value);
        break;
      default:
        // 其它字段忽略
        break;
    }
  }
}

function visitUsingComponents(context, state, value) {
  if (!value || value.type !== "Object") return;
  for (const m of value.members) {
    if (m.value && m.value.type === "String") {
      checkImport(context, state, m.value, m.value.value);
    }
  }
}

function visitComponentGenerics(context, state, value) {
  if (!value || value.type !== "Object") return;
  for (const m of value.members) {
    const v = m.value;
    if (!v) continue;
    // 允许 { name: { default: path } } 与 { name: true } 两种形式
    if (v.type === "Object") {
      for (const inner of v.members) {
        if (memberKey(inner) === "default" && inner.value?.type === "String") {
          checkImport(context, state, inner.value, inner.value.value);
        }
      }
    }
  }
}

function visitStemArray(context, state, value, pathPrefix) {
  if (!value || value.type !== "Array") return;
  for (const element of value.elements) {
    const v = element.value;
    if (v && v.type === "String") {
      // 页面 stem 没有前导 `/` 与扩展名，加前缀并加 `/` 让 resolver 当绝对路径解析
      const normalized = "/" + joinPosix(pathPrefix, v.value);
      checkAbsolute(context, state, v, v.value, normalized);
    }
  }
}

function visitSubpackages(context, state, value) {
  if (!value || value.type !== "Array") return;
  for (const element of value.elements) {
    const obj = element.value;
    if (!obj || obj.type !== "Object") continue;

    let root = "";
    let pagesNode = null;
    for (const m of obj.members) {
      const k = memberKey(m);
      if (k === "root" && m.value?.type === "String") {
        root = m.value.value;
      } else if (k === "pages") {
        pagesNode = m.value;
      }
    }
    if (pagesNode) {
      visitStemArray(context, state, pagesNode, stripSlashes(root));
    }
  }
}

function visitTabBar(context, state, tabBarValue) {
  if (!tabBarValue || tabBarValue.type !== "Object") return;
  for (const m of tabBarValue.members) {
    if (memberKey(m) !== "list" || m.value?.type !== "Array") continue;
    for (const element of m.value.elements) {
      const obj = element.value;
      if (!obj || obj.type !== "Object") continue;
      for (const im of obj.members) {
        const k = memberKey(im);
        if (
          (k === "iconPath" || k === "selectedIconPath") &&
          im.value?.type === "String"
        ) {
          visitAbsFull(context, state, im.value);
        }
      }
    }
  }
}

function visitAbsFull(context, state, stringNode) {
  const raw = stringNode.value;
  if (typeof raw !== "string" || raw === "") return;
  const normalized = raw.startsWith("/") ? raw : "/" + raw;
  checkAbsolute(context, state, stringNode, raw, normalized);
}

// ---------- 单个字符串节点的检查 ----------

/**
 * 以 "小程序原生组件引用" 语义检查：支持 `./../` 相对、`/` 绝对、裸名 miniprogram_npm。
 *
 * **不走 resolveAlias**：微信原生 JSON 配置（usingComponents / componentGenerics.default）
 * 不识别 app.json.resolveAlias；命中任何 alias 前缀都视为误用。
 */
function checkImport(context, state, node, rawRequest) {
  if (typeof rawRequest !== "string" || rawRequest === "") return;
  if (shouldIgnoreRequest(state.options.ignorePatterns, rawRequest)) return;

  // 命中 alias 前缀 → 原生小程序会编译失败，直接报错并跳过后续检查
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
    // 有意不传 aliases —— JSON 里 alias 不合法
  });

  reportResolution(context, state, node, rawRequest, resolved);
}

/**
 * 以 "小程序绝对路径" 语义检查：不走 alias，直接相对 miniprogramRoot 解析。
 *
 * 只做路径存在性校验 —— 这类字段（pages / subpackages[*].pages / tabBar iconPath /
 * themeLocation / sitemapLocation）本质是 app.json 自身对小程序结构的声明，
 * "分包边界" 在这里语义上不成立（例如 subpackages[i].pages 天然就位于该分包里）。
 */
function checkAbsolute(context, state, node, rawRequest, absoluteRequest) {
  if (!state.options.checks.pathExists) return;
  if (shouldIgnoreRequest(state.options.ignorePatterns, rawRequest)) return;

  const resolved = resolveImport(absoluteRequest, {
    currentFile: state.currentFile,
    miniprogramRoot: state.miniprogramRoot,
    extensions: state.options.extensions,
    // 有意不传 aliases，避免 pages/tabBar icon 等固定字段被用户自定义别名干扰
  });

  if (!resolved) {
    context.report({
      loc: node.loc,
      messageId: "notResolved",
      data: { request: rawRequest },
    });
  }
}

function reportResolution(context, state, node, rawRequest, resolved) {
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

// ---------- 工具 ----------

function memberKey(member) {
  const n = member.name;
  if (!n) return null;
  if (n.type === "String") return n.value;
  if (n.type === "Identifier") return n.name; // JSON5
  return null;
}

function stripSlashes(s) {
  return String(s).replace(/^[/\\]+|[/\\]+$/g, "");
}

function joinPosix(a, b) {
  const left = stripSlashes(a);
  const right = stripSlashes(b);
  if (!left) return right;
  if (!right) return left;
  return left + "/" + right;
}
