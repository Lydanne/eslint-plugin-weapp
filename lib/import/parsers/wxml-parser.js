"use strict";

/**
 * @fileoverview 极简 WXML 扫描器，只抽取我们关心的 src 属性。
 *
 * 设计：
 *   - 先把 `<!-- ... -->` 注释替换为等长空白，保证后续偏移量不偏
 *   - 扫描 `<import> / <include> / <wxs>` 三个标签的开标签
 *   - 在标签的属性区里找 `src="..."` 或 `src='...'`，忽略包含 `{{}}` 插值的动态值
 *
 * 产物是极扁平的 AST：
 *   Program { body: SrcAttribute[] }
 *   SrcAttribute { tag, value, loc/range 指向 value 字面量（不含引号）}
 */

const TAG_REGEX = /<\s*(import|include|wxs)\b([^>]*?)\/?>/gid;
const SRC_REGEX = /\bsrc\s*=\s*(["'])([^]*?)\1/gd;

/**
 * @param {string} text
 * @returns {{ast: {type:"Program", body:any[], loc:any, range:[number,number]}}}
 */
function parseWXML(text) {
  const lineStarts = computeLineStarts(text);
  const sanitized = stripComments(text);

  /** @type {any[]} */
  const body = [];

  let match;
  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(sanitized)) !== null) {
    const tagName = match[1].toLowerCase();
    // Indices 要求 `d` flag；match.indices[0] = 整段，[1] = tagName，[2] = attrs 段
    const attrsStart = match.indices[2][0];
    const attrsEnd = match.indices[2][1];
    const attrs = sanitized.slice(attrsStart, attrsEnd);

    SRC_REGEX.lastIndex = 0;
    const srcMatch = SRC_REGEX.exec(attrs);
    if (!srcMatch) continue;

    const rawValue = srcMatch[2];
    // 含 `{{}}` 动态绑定 → 跳过
    if (rawValue.includes("{{")) continue;
    if (rawValue.includes("{")) continue;

    // value (不含引号) 在 attrs 内的偏移
    const valueOffsetInAttrs = srcMatch.indices[2][0];
    const valueAbs = attrsStart + valueOffsetInAttrs;
    const endAbs = valueAbs + rawValue.length;

    body.push({
      type: "SrcAttribute",
      tag: tagName,
      value: rawValue,
      range: [valueAbs, endAbs],
      loc: {
        start: indexToLoc(valueAbs, lineStarts),
        end: indexToLoc(endAbs, lineStarts),
      },
    });
  }

  const rootLoc = {
    start: indexToLoc(0, lineStarts),
    end: indexToLoc(text.length, lineStarts),
  };

  return {
    ast: {
      type: "Program",
      body,
      range: [0, text.length],
      loc: rootLoc,
    },
  };
}

/**
 * 用同长度空白替换 `<!-- ... -->` 区段（含换行也保持原样），确保 body 偏移量稳定。
 */
function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => {
    // 保留换行，其它字符换成空格，避免破坏行号计数
    return m.replace(/[^\n\r]/g, " ");
  });
}

function computeLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 10 /* \n */) {
      starts.push(i + 1);
    } else if (ch === 13 /* \r */) {
      const next = text.charCodeAt(i + 1);
      if (next === 10) {
        starts.push(i + 2);
        i += 1;
      } else {
        starts.push(i + 1);
      }
    }
  }
  return starts;
}

function indexToLoc(index, lineStarts) {
  // binary search
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return {
    line: lo + 1, // 1-based
    column: index - lineStarts[lo] + 1, // 1-based
  };
}

module.exports = {
  parseWXML,
};
