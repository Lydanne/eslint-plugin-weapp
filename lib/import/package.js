"use strict";

/**
 * @fileoverview 小程序分包归属 + 跨分包引用边界判定。
 *
 * 主包用哨兵值 ::PKG_MAIN:: 表示：{ root: '', independent: false, name: '__main__' }。
 */

const path = require("node:path");

const MAIN_PACKAGE = Object.freeze({
  root: "",
  independent: false,
  name: "__main__",
});

/**
 * 组合主包 + 所有子包，供 findPackageOfFile 匹配。
 * @param {Array<{root:string,independent:boolean,name?:string}>} subpackages
 */
function getPackages(subpackages) {
  const normalized = Array.isArray(subpackages)
    ? subpackages.filter((sp) => sp && typeof sp.root === "string" && sp.root !== "")
    : [];
  // 按 root 长度降序以便优先匹配更深路径
  normalized.sort((a, b) => b.root.length - a.root.length);
  return [MAIN_PACKAGE, ...normalized];
}

function toPosix(p) {
  return String(p).replace(/\\/g, "/");
}

/**
 * 判定绝对文件路径所属的分包；miniprogramRoot 之外返回 null。
 *
 * @param {string} absFile
 * @param {string} miniprogramRoot
 * @param {ReturnType<typeof getPackages>} packages
 */
function findPackageOfFile(absFile, miniprogramRoot, packages) {
  const rel = toPosix(path.relative(miniprogramRoot, absFile));
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;

  for (const pkg of packages) {
    if (pkg.root === "") continue;
    if (rel === pkg.root || rel.startsWith(pkg.root + "/")) {
      return pkg;
    }
  }
  return MAIN_PACKAGE;
}

/**
 * 计算从 fromPkg 引用 toPkg 是否允许；不允许时返回对应 messageId + 数据。
 */
function canImport(fromPkg, toPkg) {
  if (!fromPkg || !toPkg) return { allowed: true };

  // 独立分包：内部互相只能引用自身；外部任何包都不能被它引用。
  if (fromPkg.independent) {
    if (fromPkg.root !== toPkg.root) {
      return {
        allowed: false,
        reason: "independentCross",
        detail: { from: fromPkg.root, to: toPkg.root || "__main__" },
      };
    }
    return { allowed: true };
  }

  // 同包（主包 → 主包、同一子包 → 同一子包）
  if (fromPkg.root === toPkg.root) return { allowed: true };

  // 主包引用子包：不允许
  if (fromPkg.root === "" && toPkg.root !== "") {
    return {
      allowed: false,
      reason: "mainImportSubpackage",
      detail: { to: toPkg.root },
    };
  }

  // 子包引用其他子包：不允许
  if (fromPkg.root !== "" && toPkg.root !== "" && fromPkg.root !== toPkg.root) {
    return {
      allowed: false,
      reason: "crossSubpackage",
      detail: { from: fromPkg.root, to: toPkg.root },
    };
  }

  // 子包引用主包：允许
  return { allowed: true };
}

module.exports = {
  MAIN_PACKAGE,
  getPackages,
  findPackageOfFile,
  canImport,
};
