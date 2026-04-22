"use strict";

/**
 * @fileoverview WXML Language 适配器（ESLint 9 Language API）。
 *
 * 解析器只产出极扁平的 AST：Program → SrcAttribute[]，诊断定位到 src 属性值本身。
 * 其余 WXML 结构（标签层级、文本子节点、属性绑定等）一律不建模。
 */

const { TextSourceCodeBase, VisitNodeStep } = require("@eslint/plugin-kit");
const { parseWXML } = require("../import/parsers/wxml-parser");

class WXMLSourceCode extends TextSourceCodeBase {
  constructor({ text, ast }) {
    super({ text, ast, lineEndingPattern: /\r\n|[\r\n]/u });
    this.ast = ast;
  }

  getLoc(node) {
    return node.loc;
  }

  getRange(node) {
    return node.range;
  }

  getParent(node) {
    if (node === this.ast) return undefined;
    return this.ast;
  }

  getAncestors(node) {
    return node === this.ast ? [] : [this.ast];
  }

  // 不支持 inline config（WXML 注释做 eslint-disable 不现实）
  getInlineConfigNodes() {
    return [];
  }
  getDisableDirectives() {
    return { directives: [], problems: [] };
  }
  applyInlineConfig() {
    return { configs: [], problems: [] };
  }

  traverse() {
    const steps = [];
    const root = this.ast;
    steps.push(
      new VisitNodeStep({ target: root, phase: 1, args: [root, null] })
    );
    for (const child of root.body) {
      steps.push(
        new VisitNodeStep({ target: child, phase: 1, args: [child, root] })
      );
      steps.push(
        new VisitNodeStep({ target: child, phase: 2, args: [child, root] })
      );
    }
    steps.push(
      new VisitNodeStep({ target: root, phase: 2, args: [root, null] })
    );
    return steps;
  }
}

class WXMLLanguage {
  constructor() {
    this.fileType = "text";
    this.lineStart = 1;
    this.columnStart = 1;
    this.nodeTypeKey = "type";
    this.visitorKeys = {
      Program: ["body"],
      SrcAttribute: [],
    };
  }

  validateLanguageOptions() {
    // 目前无可配项
  }

  parse(file) {
    try {
      const text = typeof file.body === "string" ? file.body : String(file.body);
      const { ast } = parseWXML(text);
      return { ok: true, ast };
    } catch (ex) {
      return {
        ok: false,
        errors: [
          {
            ruleId: null,
            message: ex && ex.message ? ex.message : String(ex),
            loc: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
          },
        ],
      };
    }
  }

  createSourceCode(file, parseResult) {
    const text = typeof file.body === "string" ? file.body : String(file.body);
    return new WXMLSourceCode({
      text,
      ast: parseResult.ast,
    });
  }
}

module.exports = {
  WXMLLanguage,
  WXMLSourceCode,
};
