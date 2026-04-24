"use strict";

/**
 * @fileoverview 基于 app.json 检查小程序 JS 文件的 **静态** 引用合法性：
 *   - import / require / import() / export from / .wxs require 的目标是否存在
 *   - 跨分包边界（主包 → 分包、分包 → 分包、独立分包 → 外部）
 *   - .wxs 里的 alias 误用
 *
 * 动态 API（wx.navigateTo / redirectTo / switchTab / reLaunch）跳转的 url 检查
 * 已拆分为独立规则 `weapp2/wx-navigate`。
 */

const path = require("node:path");

const {
  resolveImport,
  findMatchingAlias,
  DEFAULT_EXTENSIONS,
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
const {
  isDeclaredDependency,
  extractPackageName,
} = require("../import/package-json");

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
const WXS_EXTENSIONS = [".wxs"];

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
              mainImportSubpackage: { type: "boolean" },
              crossSubpackage: { type: "boolean" },
              independentCross: { type: "boolean" },
              independentNpm: { type: "boolean" },
            },
          },
          requireRelativePrefix: { type: "boolean" },
          bareModuleResolution: {
            enum: ["auto", "packageJson", "miniprogramNpm"],
          },
          ignorePatterns: IGNORE_PATTERNS_SCHEMA,
        },
      },
    ],
    messages: {
      appJsonNotFound:
        '无法读取小程序配置: "{{appJsonPath}}" ({{reason}})，请检查 weapp2/import 规则的 projectConfigPath 选项',
      appJsonInvalid: '解析小程序配置 "{{appJsonPath}}" 失败: {{reason}}',
      notResolved: '引用路径 "{{request}}" 无法解析到有效文件',
      mainImportSubpackage:
        '主包文件不能引用分包 "{{to}}" 中的资源: "{{request}}"',
      crossSubpackage:
        '分包 "{{from}}" 不能引用其他分包 "{{to}}" 中的资源: "{{request}}"',
      independentCross:
        '独立分包 "{{from}}" 不能引用 "{{to}}" 中的资源: "{{request}}"',
      independentNpmNotSupported:
        '独立分包 "{{from}}" 不能使用 npm 包 "{{request}}"。独立分包无法访问主包的 miniprogram_npm；如需在独立分包中使用 npm，请在该独立分包目录下单独构建 npm，生成 "{{from}}/miniprogram_npm/{{pkgName}}"',
      aliasNotSupportedInWxs:
        'WXS 文件的 require 不支持 app.json.resolveAlias（原生小程序只认相对路径）："{{request}}" 命中别名 "{{alias}}"',
      wxsRequireNotRelative:
        'WXS 文件的 require 只能引用 .wxs 文件模块，且必须使用相对路径："{{request}}"',
      jsAbsolutePathNotSupported:
        'JS require / import 不支持以 "/" 开头的绝对路径（微信运行时行为不稳定，官方 require 文档也明确写了“不支持绝对路径”）："{{request}}"。请改用 "./" / "../" 相对路径，或 app.json.resolveAlias 别名（如 "@/..."）。',
      relativePrefixRequired:
        '引用路径 "{{request}}" 不是合法裸包名（未在 package.json 依赖中声明，也不在 miniprogram_npm 中），请改写成 "./" / "../" 相对路径、app.json.resolveAlias 别名，或在 package.json 中声明该依赖',
    },
  },

  create(context) {
    const state = createFileState(context, { defaultExtensions: DEFAULT_EXTENSIONS });

    return {
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
        // Pattern 1: require('x') / require('x', cb, errCb?)
        //   多参形态是微信「分包异步化」的 callback 风格，合法跨分包加载。
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length >= 1
        ) {
          const arg = node.arguments[0];
          const literal = readStaticString(arg);
          if (literal !== null) {
            const isAsync = node.arguments.length >= 2;
            checkStatic(context, state, arg, literal, { isAsync });
          }
          return;
        }

        // Pattern 2: require.async('x')
        //   微信「分包异步化」的 Promise 风格，合法跨分包加载。
        if (
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "require" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "async" &&
          node.arguments.length >= 1
        ) {
          const arg = node.arguments[0];
          const literal = readStaticString(arg);
          if (literal !== null) {
            checkStatic(context, state, arg, literal, { isAsync: true });
          }
        }
      },
    };
  },
};

// -------- 内部实现 --------

function shouldSkipRequest(request) {
  if (typeof request !== "string" || request === "") return true;
  for (const prefix of SKIP_REQUEST_PREFIX) {
    if (request.startsWith(prefix)) return true;
  }
  return false;
}

function isRelativeRequest(request) {
  return request.startsWith("./") || request.startsWith("../");
}

/**
 * @param {object} opts
 * @param {boolean} [opts.isAsync] 是否是「分包异步化」形式的 require：
 *   - `require(path, cb, errCb?)`
 *   - `require.async(path)`
 *   这两种形式是微信官方合法的跨分包加载机制，应跳过 packageBoundary 校验。
 *   参考：https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/async.html
 */
function checkStatic(context, state, node, request, opts = {}) {
  if (!state || state.skip) return;
  if (shouldSkipRequest(request)) return;
  if (shouldIgnoreRequest(state.options.ignorePatterns, request)) return;

  // .wxs 在原生小程序里只支持相对路径，不走 resolveAlias；命中则直接报错。
  const isWxs = typeof state.currentFile === "string" && state.currentFile.endsWith(".wxs");
  if (isWxs && state.aliases.length > 0) {
    const matched = findMatchingAlias(request, state.aliases);
    if (matched) {
      context.report({
        node,
        messageId: "aliasNotSupportedInWxs",
        data: { request, alias: matched.prefix },
      });
      return;
    }
  }

  if (isWxs && !isRelativeRequest(request)) {
    context.report({
      node,
      messageId: "wxsRequireNotRelative",
      data: { request },
    });
    return;
  }

  // JS / TS 等非 wxs 文件里写 require('/xxx') / import '/xxx' 的写法：
  //   官方 require 文档明确说明“不支持绝对路径”，运行时在不同分包、不同基础库版本下行为不稳定
  //   （实际看到过 `/utils/foo` 被解为当前文件目录或当前分包根的案例）。预防性地报错，运行时不再爆。
  if (!isWxs && request.startsWith("/")) {
    context.report({
      node,
      messageId: "jsAbsolutePathNotSupported",
      data: { request },
    });
    return;
  }

  // 裸模块名（lodash / @wekit/shared / lodash/fp / …）：排除 相对路径、已在上面拦住的绝对路径、以及 alias 后剩下的 request
  if (!isWxs && !isPrefixedRequest(request) && !findMatchingAlias(request, state.aliases)) {
    const mode = state.options.bareModuleResolution;
    const inIndependent =
      state.currentPackage != null && state.currentPackage.independent === true;

    // 每种模式各自决定“看哪个判据”；判据命中即 bareAccepted。
    //   - packageJson：只看 package.json 运行时依赖声明
    //   - miniprogramNpm：只看 miniprogram_npm 是否真实构建出该包（沿目录向上查，分包自己的 miniprogram_npm 优先）
    //   - auto（默认）：两个判据取或——只要任一成立就视为合法裸包。
    const checkDeclared = mode !== "miniprogramNpm";
    const checkNpm = mode !== "packageJson";
    const declared = checkDeclared && isDeclaredBareModule(request, state);
    const inNpm = checkNpm && resolvesMiniprogramNpm(request, state);
    const bareAccepted = declared || inNpm;

    if (bareAccepted) {
      // 独立分包里用 npm 包：只有该 npm 属于独立分包自己的 miniprogram_npm 才合法。
      if (
        inIndependent &&
        state.options.checks.independentNpm &&
        reportIfForeignIndependentNpm(context, state, node, request)
      ) {
        return;
      }

      // miniprogramNpm 模式保留旧行为——命中 miniprogram_npm 后仍继续走存在性 / 分包边界检查，
      // 便于命中 crossSubpackage / independentCross 等跨界规则。
      // packageJson 和 auto 模式命中即整条静默，避免 miniprogram_npm 未构建时的假阴性。
      if (mode === "miniprogramNpm") {
        // fall through to resolveImport + boundary checks
      } else {
        return;
      }
    } else if (state.options.requireRelativePrefix) {
      context.report({
        node,
        messageId: "relativePrefixRequired",
        data: { request },
      });
      return;
    }
    // requireRelativePrefix 关掉且两个判据都没命中时不报前缀错，但后续 resolveImport 大概率还是会 notResolved。
  }

  const resolved = resolveImport(request, {
    currentFile: state.currentFile,
    miniprogramRoot: state.miniprogramRoot,
    extensions: isWxs ? WXS_EXTENSIONS : state.options.extensions,
    aliases: isWxs ? undefined : state.aliases,
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

  // 分包异步化：官方合法跨分包加载机制，路径存在性校验之后静默通过。
  if (opts.isAsync) return;

  const targetPackage = findPackageOfFile(
    resolved,
    state.miniprogramRoot,
    state.packages
  );
  if (!targetPackage) return; // 解析到 miniprogramRoot 之外的文件（例如 miniprogram_npm 外部）

  const result = canImport(state.currentPackage, targetPackage);
  if (!result.allowed) {
    // 细粒度子开关 gate：关掉对应 reason 后静默跳过，方便在特殊项目结构里按 case 放行。
    if (state.options.checks[result.reason] === false) return;
    context.report({
      node,
      messageId: result.reason,
      data: { request, ...result.detail },
    });
  }
}

function isPrefixedRequest(request) {
  // 绝对路径 "/xxx" 不再视为“合法前缀”，交给 jsAbsolutePathNotSupported 拦截
  return isRelativeRequest(request);
}

function isDeclaredBareModule(request, state) {
  if (!state || typeof state.projectRoot !== "string") return false;
  return isDeclaredDependency(request, state.projectRoot);
}

/**
 * 在独立分包中，若 request 对应的 npm 不属于"该独立分包自己的 miniprogram_npm"，报错并返回 true；
 * 否则不报错并返回 false。调用方根据返回值决定是否直接 return。
 */
function reportIfForeignIndependentNpm(context, state, node, request) {
  const resolved = resolveImport(request, {
    currentFile: state.currentFile,
    miniprogramRoot: state.miniprogramRoot,
    extensions: state.options.extensions,
  });
  const owner = getNpmOwnerRoot(resolved, state.miniprogramRoot);
  // owner === null：根本没解析到 miniprogram_npm（例如 packageJson 声明了但谁都没构建）→ 视为"独立分包用不了"。
  // owner !== currentPackage.root：命中了主包或其它分包的 miniprogram_npm → 独立分包无法访问。
  if (owner === state.currentPackage.root) return false;
  context.report({
    node,
    messageId: "independentNpmNotSupported",
    data: {
      request,
      from: state.currentPackage.root,
      pkgName: extractPackageName(request) || request,
    },
  });
  return true;
}

/**
 * 根据 resolveImport 返回的绝对路径，判断其 miniprogram_npm 属于哪个分包 root。
 *   - "<miniprogramRoot>/miniprogram_npm/foo/..." → ""（主包）
 *   - "<miniprogramRoot>/subInd/miniprogram_npm/foo/..." → "subInd"
 *   - 非 miniprogram_npm 路径或 resolved 为空 → null
 *
 * 注：只看从 miniprogramRoot 算起的**第一个** miniprogram_npm 段；避免 "foo/miniprogram_npm/bar" 这种包名含
 * miniprogram_npm 的极端情况误判（极少见，但保证确定性）。
 */
function getNpmOwnerRoot(resolved, miniprogramRoot) {
  if (typeof resolved !== "string" || resolved === "") return null;
  const rel = path.relative(miniprogramRoot, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const segs = rel.split(/[\\/]+/);
  const idx = segs.indexOf("miniprogram_npm");
  if (idx === -1) return null;
  return segs.slice(0, idx).join("/");
}

function resolvesMiniprogramNpm(request, state) {
  const resolved = resolveImport(request, {
    currentFile: state.currentFile,
    miniprogramRoot: state.miniprogramRoot,
    extensions: state.options.extensions,
  });
  return (
    typeof resolved === "string" &&
    resolved.split(/[\\/]+/).includes("miniprogram_npm")
  );
}
