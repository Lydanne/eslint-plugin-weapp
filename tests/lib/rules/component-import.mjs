import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { RuleTester } from "eslint";
import json from "@eslint/json";

const require = createRequire(import.meta.url);
require("../../../lib");
const rule = require("../../../lib/rules/component-import");
const { clearCache } = require("../../../lib/import/app-json");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../fixtures/miniprogram");
const APP_JSON = path.join(ROOT, "app.json");
const PROJECT_CONFIG = path.resolve(__dirname, "../../fixtures/project.config.json");

function file(...segments) {
  return path.join(ROOT, ...segments);
}

function opts(extra) {
  return [Object.assign({ projectConfigPath: PROJECT_CONFIG }, extra || {})];
}

const ruleTester = new RuleTester({
  plugins: { json },
  language: "json/json",
});

clearCache();

ruleTester.run("component-import", rule, {
  valid: [
    // 1. 主包页面 usingComponents 引用主包组件
    {
      code: `{ "usingComponents": { "hello": "/components/hello/hello" } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
    },
    // 1b. requireRelativePrefix 默认开启时，合法 miniprogram_npm 裸包名仍允许
    {
      code: `{ "usingComponents": { "lodash": "lodash" } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
    },
    // 2. 相对路径
    {
      code: `{ "usingComponents": { "hello": "../../components/hello/hello" } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
    },
    // 4. 子包内部 usingComponents
    {
      code: `{ "usingComponents": { "foo": "/subA/components/foo/foo" } }`,
      filename: file("subA/pages/a1/a1.json"),
      options: opts(),
    },
    // 5. 子包 → 主包组件（普通分包允许）
    {
      code: `{ "usingComponents": { "hello": "/components/hello/hello" } }`,
      filename: file("subA/pages/a1/a1.json"),
      options: opts(),
    },
    // 5b. 分包异步化：componentPlaceholder 覆盖对应组件名时允许跨分包组件引用
    {
      code: `{ "usingComponents": { "foo": "/subA/components/foo/foo" }, "componentPlaceholder": { "foo": "view" } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
    },
    // 5c. 分包异步化：占位符可以是自定义组件名，不限于 view
    {
      code: `{ "usingComponents": { "b1": "/subB/pages/b1/b1" }, "componentPlaceholder": { "b1": "local-placeholder" } }`,
      filename: file("subA/pages/a1/a1.json"),
      options: opts(),
    },
    // 6. componentGenerics.default
    {
      code: `{ "componentGenerics": { "slot": { "default": "/components/hello/hello" } } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
    },
    // 7. app.json 的 pages（stem 不带扩展名）
    {
      code: `{ "pages": ["pages/index/index", "pages/detail/detail"] }`,
      filename: APP_JSON,
      options: opts(),
    },
    // 8. app.json 的 subpackages.pages
    {
      code: `{ "subpackages": [ { "root": "subA", "pages": ["pages/a1/a1"] } ] }`,
      filename: APP_JSON,
      options: opts(),
    },
    // 9. tabBar iconPath（带扩展名的绝对资源）
    {
      code: `{ "tabBar": { "list": [ { "iconPath": "images/tab-home.png", "selectedIconPath": "/images/tab-home-active.png" } ] } }`,
      filename: APP_JSON,
      options: opts(),
    },
    // 10. themeLocation / sitemapLocation
    {
      code: `{ "sitemapLocation": "sitemap.json" }`,
      filename: APP_JSON,
      options: opts(),
    },
    // 11. 未配置 projectConfigPath 且找不到 project.config.json → 规则静默跳过
    {
      code: `{ "usingComponents": { "hello": "/no-such/thing" } }`,
      filename: path.resolve(__dirname, "../../no-project/pages/index/index.json"),
    },
    // 12. 文件不在 miniprogramRoot → 跳过
    {
      code: `{ "usingComponents": { "x": "/no/where" } }`,
      filename: path.resolve(__dirname, "../../fixtures/outside.json"),
      options: opts(),
    },
    // 13. ignorePatterns：匹配到的路径整条跳过
    {
      code: `{ "usingComponents": { "x": "/no/where" } }`,
      filename: file("pages/index/index.json"),
      options: opts({ ignorePatterns: ["^/no/"] }),
    },
    // 14. 未配置 projectConfigPath 时，自动向上查找 project.config.json 定位 app.json
    {
      code: `{ "usingComponents": { "hello": "/components/hello/hello" } }`,
      filename: file("pages/index/index.json"),
    },
  ],

  invalid: [
    // 1. 主包组件配置引用分包组件 → mainImportSubpackage
    {
      code: `{ "usingComponents": { "foo": "/subA/components/foo/foo" } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
      errors: [{ messageId: "mainImportSubpackage" }],
    },
    // 2. 跨分包 → crossSubpackage
    {
      code: `{ "usingComponents": { "b1": "/subB/pages/b1/b1" } }`,
      filename: file("subA/pages/a1/a1.json"),
      options: opts(),
      errors: [{ messageId: "crossSubpackage" }],
    },
    // 3. 独立分包引用主包 → independentCross
    {
      code: `{ "usingComponents": { "hello": "/components/hello/hello" } }`,
      filename: file("subInd/pages/i1/i1.json"),
      options: opts(),
      errors: [{ messageId: "independentCross" }],
    },
    // 4. 不存在路径 → notResolved
    {
      code: `{ "usingComponents": { "missing": "/not/there" } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
      errors: [{ messageId: "notResolved", data: { request: "/not/there" } }],
    },
    // 5. 不存在的页面 stem
    {
      code: `{ "pages": ["pages/ghost/ghost"] }`,
      filename: APP_JSON,
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 6. 不存在的子包 page stem
    {
      code: `{ "subpackages": [ { "root": "subA", "pages": ["pages/ghost/ghost"] } ] }`,
      filename: APP_JSON,
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 7. 不存在的 tabBar iconPath
    {
      code: `{ "tabBar": { "list": [ { "iconPath": "images/not-there.png" } ] } }`,
      filename: APP_JSON,
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 8. componentGenerics.default 不存在
    {
      code: `{ "componentGenerics": { "slot": { "default": "/components/ghost/ghost" } } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 9. usingComponents 使用 alias → 原生 JSON 不支持，直接报 aliasNotSupported（不再展开）
    {
      code: `{ "usingComponents": { "foo": "@/components/hello/hello" } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
      errors: [
        {
          messageId: "aliasNotSupported",
          data: { request: "@/components/hello/hello", alias: "@/" },
        },
      ],
    },
    // 9b. 精确别名（~utils）也一样
    {
      code: `{ "usingComponents": { "u": "~utils" } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
      errors: [{ messageId: "aliasNotSupported" }],
    },
    // 9c. componentGenerics.default 里的 alias 同样不合法
    {
      code: `{ "componentGenerics": { "slot": { "default": "@/components/hello/hello" } } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
      errors: [{ messageId: "aliasNotSupported" }],
    },
    // 10. requireRelativePrefix 默认开启：不允许把本地路径写成裸路径
    {
      code: `{ "usingComponents": { "hello": "components/hello/hello" } }`,
      filename: file("pages/index/index.json"),
      options: opts(),
      errors: [
        {
          messageId: "relativePrefixRequired",
          data: { request: "components/hello/hello" },
        },
      ],
    },
    // 11. projectConfigPath 指向不存在文件 → Document 级报错
    {
      code: `{ "usingComponents": { "x": "/x" } }`,
      filename: file("pages/index/index.json"),
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
