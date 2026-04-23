import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { RuleTester } from "eslint";
import css from "@eslint/css";

const require = createRequire(import.meta.url);
require("../../../lib");
const rule = require("../../../lib/rules/wxss-import");
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
  plugins: { css },
  language: "css/css",
  languageOptions: { tolerant: true },
});

clearCache();

ruleTester.run("wxss-import", rule, {
  valid: [
    // 1. 相对路径 @import
    {
      code: `@import "../../styles/common.wxss";`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
    },
    // 2. 小程序绝对路径 @import
    {
      code: `@import "/styles/common.wxss";`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
    },
    // 3. 省略扩展名（依赖 CSS_EXTENSIONS 兜 .wxss）
    {
      code: `@import "/styles/common";`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
    },
    // 4. url() 形态
    {
      code: `@import url("/styles/common.wxss");`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
    },
    // 6. 分包内部互引
    {
      code: `@import "/subA/styles/a.wxss";`,
      filename: file("subA/pages/a1/a1.wxss"),
      options: opts(),
    },
    // 7. 分包 → 主包允许
    {
      code: `@import "/styles/common.wxss";`,
      filename: file("subA/pages/a1/a1.wxss"),
      options: opts(),
    },
    // 8. 独立分包内部互引
    {
      code: `@import "/subInd/styles/ind.wxss";`,
      filename: file("subInd/pages/i1/i1.wxss"),
      options: opts(),
    },
    // 9. 远程 URL 跳过
    {
      code: `@import "https://example.com/a.css";`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
    },
    // 10. 未配置 projectConfigPath 且找不到 project.config.json → 规则静默跳过
    {
      code: `@import "/not/exist.wxss";`,
      filename: path.resolve(__dirname, "../../no-project/pages/index/index.wxss"),
    },
    // 11. 文件不在 miniprogramRoot → 跳过
    {
      code: `@import "/x.wxss";`,
      filename: path.resolve(__dirname, "../../fixtures/outside.wxss"),
      options: opts(),
    },
    // 12. ignorePatterns：匹配到的 @import 整条跳过
    {
      code: `@import "/ghost.wxss";`,
      filename: file("pages/index/index.wxss"),
      options: opts({ ignorePatterns: ["^/ghost"] }),
    },
    // 13. 未配置 projectConfigPath 时，自动向上查找 project.config.json 定位 app.json
    {
      code: `@import "/styles/common.wxss";`,
      filename: file("pages/index/index.wxss"),
    },
  ],

  invalid: [
    // 1. 不存在的相对路径
    {
      code: `@import "./nowhere.wxss";`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 2. 不存在的绝对路径
    {
      code: `@import "/ghost.wxss";`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 3. 主包 @import 分包 → mainImportSubpackage
    {
      code: `@import "/subA/styles/a.wxss";`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
      errors: [{ messageId: "mainImportSubpackage" }],
    },
    // 4. 跨分包
    {
      code: `@import "/subInd/styles/ind.wxss";`,
      filename: file("subA/pages/a1/a1.wxss"),
      options: opts(),
      errors: [{ messageId: "crossSubpackage" }],
    },
    // 5. 独立分包 → 主包
    {
      code: `@import "/styles/common.wxss";`,
      filename: file("subInd/pages/i1/i1.wxss"),
      options: opts(),
      errors: [{ messageId: "independentCross" }],
    },
    // 6. @import 里用 alias → 原生 WXSS 不支持，直接报 aliasNotSupported
    {
      code: `@import "@/styles/common.wxss";`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
      errors: [
        {
          messageId: "aliasNotSupported",
          data: { request: "@/styles/common.wxss", alias: "@/" },
        },
      ],
    },
    // 6b. alias 即使指向存在的跨分包目标也是 aliasNotSupported（不再展开达分包边界）
    {
      code: `@import "@/subA/styles/a.wxss";`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
      errors: [{ messageId: "aliasNotSupported" }],
    },
    // 7. url() 也会报
    {
      code: `@import url("/ghost.wxss");`,
      filename: file("pages/index/index.wxss"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 8. projectConfigPath 指向不存在文件 → 根节点级报
    {
      code: `@import "/x.wxss";`,
      filename: file("pages/index/index.wxss"),
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
