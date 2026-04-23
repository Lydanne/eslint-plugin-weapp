import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { RuleTester } from "eslint";

const require = createRequire(import.meta.url);
const plugin = require("../../../lib");
const rule = require("../../../lib/rules/wxml-import");
const { clearCache } = require("../../../lib/import/app-json");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../fixtures/miniprogram");
const PROJECT_CONFIG = path.resolve(__dirname, "../../fixtures/project.config.json");

function file(...segments) {
  return path.join(ROOT, ...segments);
}

function opts(extra) {
  return [Object.assign({ projectConfigPath: PROJECT_CONFIG }, extra || {})];
}

const ruleTester = new RuleTester({
  plugins: { weapp2: plugin },
  language: "weapp2/wxml",
});

clearCache();

ruleTester.run("wxml-import", rule, {
  valid: [
    // 1. <import> 绝对路径
    {
      code: `<import src="/templates/base.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
    },
    // 2. <import> 相对路径（省略扩展名，落 .wxml）
    {
      code: `<import src="../../templates/base"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
    },
    // 3. <include>
    {
      code: `<include src="../../templates/slot.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
    },
    // 4. <wxs src> 相对路径
    {
      code: `<wxs src="../../utils/shared.wxs" module="u"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
    },
    // 4b. <wxs src> 小程序绝对路径
    {
      code: `<wxs src="/utils/shared.wxs" module="u"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
    },
    // 5. <wxs src> 相对 + 省略扩展名
    {
      code: `<wxs src="./shared" module="u"/>`,
      filename: file("utils/main.wxml"),
      options: opts(),
    },
    // 5b. <import> 同目录写法
    {
      code: `<import src="index.skeleton.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
    },
    // 7. 动态绑定 {{}} → 规则跳过
    {
      code: `<import src="{{url}}"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
    },
    // 8. 注释里的 src 不应被当作真实引用
    {
      code: `<!-- <import src="/not-exist.wxml"/> --><view/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
    },
    // 9. 子包内部 <import>
    {
      code: `<import src="/subB/templates/b.wxml"/>`,
      filename: file("subB/pages/b1/b1.wxml"),
      options: opts(),
    },
    // 10. 分包 → 主包允许
    {
      code: `<import src="/templates/base.wxml"/>`,
      filename: file("subA/pages/a1/a1.wxml"),
      options: opts(),
    },
    // 11. 未配置 projectConfigPath 且找不到 project.config.json → 规则静默跳过
    {
      code: `<import src="/not-exist.wxml"/>`,
      filename: path.resolve(__dirname, "../../no-project/pages/index/index.wxml"),
    },
    // 12. 文件不在 miniprogramRoot → 跳过
    {
      code: `<import src="/x.wxml"/>`,
      filename: path.resolve(__dirname, "../../fixtures/outside.wxml"),
      options: opts(),
    },
    // 13. 多标签混合：都合法
    {
      code: `
        <import src="/templates/base.wxml"/>
        <include src="/templates/slot.wxml"/>
        <wxs src="../../utils/shared.wxs" module="u"/>
      `,
      filename: file("pages/index/index.wxml"),
      options: opts(),
    },
    // 14. ignorePatterns：匹配到的 src 整条跳过
    {
      code: `<import src="/no/where.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts({ ignorePatterns: ["^/no/"] }),
    },
    // 15. 未配置 projectConfigPath 时，自动向上查找 project.config.json 定位 app.json
    {
      code: `<import src="/templates/base.wxml"/>`,
      filename: file("pages/index/index.wxml"),
    },
  ],

  invalid: [
    // 1. <import> 找不到目标
    {
      code: `<import src="/no/where.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
      errors: [
        {
          messageId: "notResolved",
          data: { request: "/no/where.wxml", tag: "<import>" },
        },
      ],
    },
    // 2. <include> 相对路径找不到
    {
      code: `<include src="./does-not-exist.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 3. <wxs> 找不到
    {
      code: `<wxs src="../../utils/ghost.wxs" module="u"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
      errors: [
        {
          messageId: "notResolved",
          data: { request: "../../utils/ghost.wxs", tag: "<wxs>" },
        },
      ],
    },
    // 4. <wxs src="./bare"> 不应兜到同名 .wxml
    {
      code: `<wxs src="./base" module="u"/>`,
      filename: file("templates/meta.wxml"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 5. 主包引用分包
    {
      code: `<import src="/subA/pages/a1/a1.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
      errors: [{ messageId: "mainImportSubpackage" }],
    },
    // 6. 跨分包
    {
      code: `<include src="/subB/templates/b.wxml"/>`,
      filename: file("subA/pages/a1/a1.wxml"),
      options: opts(),
      errors: [{ messageId: "crossSubpackage" }],
    },
    // 7. 独立分包 → 主包
    {
      code: `<import src="/templates/base.wxml"/>`,
      filename: file("subInd/pages/i1/i1.wxml"),
      options: opts(),
      errors: [{ messageId: "independentCross" }],
    },
    // 8. WXML src 里用 alias → 原生不支持，直接报 aliasNotSupported
    {
      code: `<import src="@/templates/base.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
      errors: [
        {
          messageId: "aliasNotSupported",
          data: {
            request: "@/templates/base.wxml",
            tag: "<import>",
            alias: "@/",
          },
        },
      ],
    },
    // 8b. <include> / <wxs> 同样
    {
      code: `<include src="@/templates/slot.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
      errors: [{ messageId: "aliasNotSupported" }],
    },
    {
      code: `<wxs src="@/utils/shared.wxs" module="u"/>`,
      filename: file("pages/index/index.wxml"),
      options: opts(),
      errors: [{ messageId: "aliasNotSupported" }],
    },
    // 9. projectConfigPath 指向不存在文件 → Program 级报错
    {
      code: `<import src="/whatever.wxml"/>`,
      filename: file("pages/index/index.wxml"),
      options: [
        {
          projectConfigPath: path.resolve(
            __dirname,
            "../../fixtures/__missing_project.config.json"
          ),
        },
      ],
      errors: [{ messageId: "appJsonNotFound" }],
    },
  ],
});
