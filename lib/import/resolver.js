"use strict";

/**
 * @fileoverview 将小程序 JS 中的 import/require 路径解析为绝对文件路径。
 *
 * 解析规则：
 *   - 以 "/" 开头：相对 miniprogramRoot。
 *   - 以 "./" 或 "../" 开头：相对当前文件目录。
 *   - 裸模块名：向上查找 miniprogram_npm 目录。
 *
 * 补全策略：先按原路径判断；否则按 extensions 逐个追加；最后按目录 + index.{ext} 兜底。
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_EXTENSIONS = [".js", ".ts", ".mjs", ".cjs", ".json", ".wxs"];

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function resolveWithExtensions(basePath, extensions) {
  if (isFile(basePath)) return basePath;
  for (const ext of extensions) {
    const withExt = basePath + ext;
    if (isFile(withExt)) return withExt;
  }
  if (isDirectory(basePath)) {
    for (const ext of extensions) {
      const candidate = path.join(basePath, "index" + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function resolveMiniprogramNpm(pkgRequest, currentFile, miniprogramRoot, extensions) {
  // 沿目录树向上查找 miniprogram_npm，直到 miniprogramRoot（含）为止。
  const rootAbs = path.resolve(miniprogramRoot);
  let dir = path.dirname(path.resolve(currentFile));
  // 安全阀，避免异常目录导致无限循环
  for (let i = 0; i < 64; i++) {
    const candidateBase = path.join(dir, "miniprogram_npm", pkgRequest);
    const resolved = resolveWithExtensions(candidateBase, extensions);
    if (resolved) return resolved;

    if (dir === rootAbs) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 按 resolveAlias 表做一次前缀/精确替换。命中则返回替换后的新 request，否则返回 null。
 *
 * @param {string} request
 * @param {Array<{wildcard:boolean, prefix:string, replacement:string}>} aliases
 * @returns {string|null}
 */
function applyAliases(request, aliases) {
  if (!Array.isArray(aliases) || aliases.length === 0) return null;
  for (const alias of aliases) {
    if (alias.wildcard) {
      if (request.startsWith(alias.prefix)) {
        return alias.replacement + request.slice(alias.prefix.length);
      }
    } else if (request === alias.prefix) {
      return alias.replacement;
    }
  }
  return null;
}

/**
 * 找出 request 命中的 alias 条目（不替换）。供"该语境不支持 alias"的规则识别误用。
 *
 * @param {string} request
 * @param {Array<{wildcard:boolean, prefix:string, replacement:string}>} aliases
 * @returns {{wildcard:boolean, prefix:string, replacement:string}|null}
 */
function findMatchingAlias(request, aliases) {
  if (!Array.isArray(aliases) || aliases.length === 0) return null;
  for (const alias of aliases) {
    if (alias.wildcard) {
      if (request.startsWith(alias.prefix)) return alias;
    } else if (request === alias.prefix) {
      return alias;
    }
  }
  return null;
}

/**
 * @param {string} request 原始路径字符串（可能含 query / hash，调用方若需保留应自行处理）。
 * @param {{
 *   currentFile:string,
 *   miniprogramRoot:string,
 *   extensions?:string[],
 *   aliases?:Array<{wildcard:boolean,prefix:string,replacement:string}>
 * }} options
 * @returns {string|null} 命中的绝对文件路径，或 null（无法解析）。
 */
function resolveImport(request, options) {
  if (typeof request !== "string" || request === "") return null;
  const { currentFile, miniprogramRoot } = options;
  const extensions = options.extensions || DEFAULT_EXTENSIONS;

  // 先尝试 app.json.resolveAlias 替换；只做一次，避免别名递归
  const aliased = applyAliases(request, options.aliases);
  const effective = aliased !== null ? aliased : request;

  // 小程序绝对路径
  if (effective.startsWith("/")) {
    const abs = path.join(miniprogramRoot, effective);
    return resolveWithExtensions(abs, extensions);
  }

  // 相对路径
  if (effective.startsWith("./") || effective.startsWith("../")) {
    const abs = path.resolve(path.dirname(currentFile), effective);
    return resolveWithExtensions(abs, extensions);
  }

  // 裸模块 → miniprogram_npm
  return resolveMiniprogramNpm(effective, currentFile, miniprogramRoot, extensions);
}

module.exports = {
  resolveImport,
  applyAliases,
  findMatchingAlias,
  DEFAULT_EXTENSIONS,
};
