"use strict";

/**
 * @fileoverview 读取"小程序项目根"下的 package.json，缓存其运行时依赖名集合。
 *
 * 约定：package.json 与 project.config.json 同处小程序项目根目录。调用方
 * （state.js）已经解析过 project.config.json，直接把它所在目录交给本模块即可，
 * 不需要在这里再做"沿目录向上查找"。
 *
 * 只读 **运行时依赖** 字段：`dependencies` / `peerDependencies` /
 * `optionalDependencies`。`devDependencies` 是构建 / 测试 / 类型等开发态工具链，
 * 不会出现在小程序运行产物里，把它算作"合法裸包名"会放过真正该报的错。
 *
 * 选择这个信息源（而不是 miniprogram_npm 目录）的原因：微信开发者工具的
 * miniprogram_npm 是"构建 npm"产物，需手动构建才会生成；开发阶段就用
 * miniprogram_npm 做合法性依据会产生大量假阳性。
 */

const fs = require("node:fs");
const path = require("node:path");

const PACKAGE_JSON_CACHE = new Map(); // pkgPath -> { mtimeMs, size, deps: Set<string> }

const DEP_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

/**
 * 读取 `${projectRoot}/package.json` 并返回运行时依赖名 Set。
 * 文件不存在 / 读取失败 / 解析失败都返回 null 由调用方自行处理。
 */
function loadPackageDepsFromDir(projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot === "") return null;
  const pkgPath = path.join(projectRoot, "package.json");

  let stat;
  try {
    stat = fs.statSync(pkgPath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const cached = PACKAGE_JSON_CACHE.get(pkgPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.deps;
  }

  const deps = new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    for (const field of DEP_FIELDS) {
      const obj = raw && raw[field];
      if (obj && typeof obj === "object") {
        for (const name of Object.keys(obj)) deps.add(name);
      }
    }
  } catch {
    // 解析失败 → 视作没有依赖声明，仍然缓存（空 Set）避免反复读盘
  }

  PACKAGE_JSON_CACHE.set(pkgPath, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    deps,
  });
  return deps;
}

/**
 * 从 request 截取 "包名"：
 *   - "lodash"           → "lodash"
 *   - "lodash/fp"        → "lodash"
 *   - "@wekit/shared"    → "@wekit/shared"
 *   - "@wekit/shared/a"  → "@wekit/shared"
 *
 * 非裸模块名（./ ../ / 开头、空串）返回 null，留给调用方自己过滤。
 */
function extractPackageName(request) {
  if (typeof request !== "string" || request === "") return null;
  if (request.startsWith("/") || request.startsWith("./") || request.startsWith("../")) {
    return null;
  }
  if (request.startsWith("@")) {
    const parts = request.split("/");
    if (parts.length < 2) return null;
    return parts[0] + "/" + parts[1];
  }
  const idx = request.indexOf("/");
  return idx === -1 ? request : request.slice(0, idx);
}

/**
 * request 的包名是否在 projectRoot/package.json 的运行时依赖集合里。
 */
function isDeclaredDependency(request, projectRoot) {
  const deps = loadPackageDepsFromDir(projectRoot);
  if (!deps || deps.size === 0) return false;
  const pkgName = extractPackageName(request);
  if (!pkgName) return false;
  return deps.has(pkgName);
}

function clearCache() {
  PACKAGE_JSON_CACHE.clear();
}

module.exports = {
  loadPackageDepsFromDir,
  extractPackageName,
  isDeclaredDependency,
  clearCache,
};
