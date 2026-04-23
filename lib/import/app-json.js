"use strict";

/**
 * @fileoverview 读取并缓存小程序 app.json。
 * 严格 JSON 解析；按绝对路径 + mtime 做缓存，避免重复磁盘 IO。
 */

const fs = require("node:fs");
const path = require("node:path");

const CACHE = new Map();
const PROJECT_CONFIG_BASENAME = "project.config.json";

/**
 * 读取并解析 app.json。
 *
 * @param {string} appJsonPath 绝对路径；调用方负责解析相对路径。
 * @returns {{
 *   appJsonPath: string,
 *   miniprogramRoot: string,
 *   raw: object,
 *   subpackages: Array<{root:string,independent:boolean,name?:string,pages?:string[]}>,
 *   pages: string[],
 *   tabBarPages: string[]
 * } | { error: Error, appJsonPath: string }}
 */
function loadAppJson(appJsonPath) {
  if (!appJsonPath || typeof appJsonPath !== "string") {
    return null;
  }

  const absPath = path.isAbsolute(appJsonPath)
    ? appJsonPath
    : path.resolve(appJsonPath);

  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (error) {
    return { appJsonPath: absPath, error };
  }

  const cached = CACHE.get(absPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.value;
  }

  let raw;
  try {
    const text = fs.readFileSync(absPath, "utf8");
    raw = JSON.parse(text);
  } catch (error) {
    const value = { appJsonPath: absPath, error };
    CACHE.set(absPath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  }

  const miniprogramRoot = path.dirname(absPath);
  const subpackages = normalizeSubpackages(
    raw.subpackages || raw.subPackages || []
  );
  const pages = Array.isArray(raw.pages) ? raw.pages.slice() : [];
  const tabBarPages = Array.isArray(raw?.tabBar?.list)
    ? raw.tabBar.list
        .map((item) => (item && typeof item.pagePath === "string" ? item.pagePath : null))
        .filter(Boolean)
    : [];
  const aliases = normalizeAliases(raw.resolveAlias);

  const value = {
    appJsonPath: absPath,
    miniprogramRoot,
    raw,
    subpackages,
    pages,
    tabBarPages,
    aliases,
  };

  CACHE.set(absPath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

/**
 * 解析规则配置里的 projectConfigPath。
 *
 * @param {string} configuredPath project.config.json 的路径
 * @param {string} [baseDir] 相对路径解析基准目录
 * @returns {{ appJsonPath: string } | { appJsonPath: string, error: Error } | null}
 */
function resolveConfiguredProjectConfigPath(
  configuredPath,
  baseDir = process.cwd()
) {
  if (!configuredPath || typeof configuredPath !== "string") {
    return null;
  }

  const projectConfigPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(baseDir, configuredPath);

  return resolveAppJsonPathFromProjectConfig(projectConfigPath);
}

/**
 * 从起始目录向上查找 project.config.json，并按其中的 miniprogramRoot 定位 app.json。
 *
 * @param {string} startDir
 * @returns {{ appJsonPath: string } | { appJsonPath: string, error: Error } | null}
 */
function resolveAppJsonPathFromNearestProjectConfig(startDir) {
  const projectConfigPath = findNearestProjectConfig(startDir);
  if (!projectConfigPath) return null;
  return resolveAppJsonPathFromProjectConfig(projectConfigPath);
}

function findNearestProjectConfig(startDir) {
  if (!startDir || typeof startDir !== "string") return null;

  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, PROJECT_CONFIG_BASENAME);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveAppJsonPathFromProjectConfig(projectConfigPath) {
  let raw;
  try {
    const text = fs.readFileSync(projectConfigPath, "utf8");
    raw = JSON.parse(stripBom(text));
  } catch (error) {
    return { appJsonPath: projectConfigPath, error };
  }

  const projectDir = path.dirname(projectConfigPath);
  const miniprogramRoot =
    typeof raw?.miniprogramRoot === "string" ? raw.miniprogramRoot : "";

  return {
    appJsonPath: path.resolve(projectDir, miniprogramRoot, "app.json"),
  };
}

function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff
    ? text.slice(1)
    : text;
}

function normalizeSubpackages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const root = typeof item.root === "string" ? stripSlashes(item.root) : "";
      if (!root) return null;
      return {
        root,
        independent: !!item.independent,
        name: typeof item.name === "string" ? item.name : undefined,
        pages: Array.isArray(item.pages) ? item.pages.slice() : [],
      };
    })
    .filter(Boolean);
}

function stripSlashes(value) {
  return String(value).replace(/^[/\\]+|[/\\]+$/g, "");
}

/**
 * 把 app.json.resolveAlias 对象归一化为可消费的匹配表。
 *
 * 规则（对齐微信开发者工具）：
 *   - key/value 同时以 `/*` 结尾 ⇒ 通配前缀替换（value 也必须以 `/*` 结尾，否则忽略）
 *   - 否则视为完全匹配
 *   - 非字符串值直接跳过
 *
 * 排序：精确匹配优先，再按前缀长度降序，避免短别名吞掉长别名。
 *
 * @returns {Array<{wildcard:boolean, prefix:string, replacement:string}>}
 */
function normalizeAliases(raw) {
  if (!raw || typeof raw !== "object") return [];
  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== "string" || typeof value !== "string") continue;
    if (key === "" || value === "") continue;

    const keyWildcard = key.endsWith("/*");
    const valueWildcard = value.endsWith("/*");

    if (keyWildcard && valueWildcard) {
      entries.push({
        wildcard: true,
        // 例如 `@/*` → prefix = `@/`
        prefix: key.slice(0, -1),
        replacement: value.slice(0, -1),
      });
    } else if (!keyWildcard && !valueWildcard) {
      entries.push({
        wildcard: false,
        prefix: key,
        replacement: value,
      });
    }
    // 一边带 * 一边不带 ⇒ 不规范，直接跳过
  }

  entries.sort((a, b) => {
    if (a.wildcard !== b.wildcard) return a.wildcard ? 1 : -1;
    return b.prefix.length - a.prefix.length;
  });

  return entries;
}

function clearCache() {
  CACHE.clear();
}

module.exports = {
  loadAppJson,
  resolveConfiguredProjectConfigPath,
  resolveAppJsonPathFromNearestProjectConfig,
  clearCache,
};
