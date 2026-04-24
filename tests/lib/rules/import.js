"use strict";

const path = require("node:path");
const { RuleTester } = require("eslint");

require("../../../lib");
const { clearCache } = require("../../../lib/import/app-json");
const rule = require("../../../lib/rules/import");

const ROOT = path.resolve(__dirname, "../../fixtures/miniprogram");
const PROJECT_CONFIG = path.resolve(__dirname, "../../fixtures/project.config.json");

function file(...segments) {
  return path.join(ROOT, ...segments);
}

function opts(extra) {
  return [Object.assign({ projectConfigPath: PROJECT_CONFIG }, extra || {})];
}

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

// 每次跑前清空 app.json 缓存，避免并行 mocha 进程状态互相干扰
clearCache();

ruleTester.run("import", rule, {
  valid: [
    // 1. 未配置 projectConfigPath 且找不到 project.config.json → 规则应静默跳过
    {
      code: "require('./not-exist');",
      filename: path.resolve(__dirname, "../../no-project/pages/index/index.js"),
    },
    // 2. 主包内相对路径引用主包工具
    {
      code: "require('../../utils/util');",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 3. 主包内 import 语法
    {
      code: "import { noop } from '../../utils/util';",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 4. 小程序绝对路径（/ 开头）
    {
      code: "require('/utils/util');",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 5. 子包 → 主包允许
    {
      code: "require('/utils/util');",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
    },
    // 6. 子包内部互引
    {
      code: "require('../../components/foo/foo');",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
    },
    // 7. miniprogram_npm
    {
      code: "const _ = require('lodash');",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 7b. requireRelativePrefix 默认开启时，合法 miniprogram_npm 裸包名仍允许
    {
      code: "import _ from 'lodash';",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 8. 动态 import()
    {
      code: "import('/utils/util');",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 10. 跳过协议类 import（不应误报）
    {
      code: "require('plugin://foo/bar');",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 12. 文件不在 miniprogramRoot 下 → 跳过
    {
      code: "require('./foo');",
      filename: path.resolve(__dirname, "../../fixtures/outside.js"),
      options: opts(),
    },
    // 13. 禁用所有检查 → 不报
    {
      code: "require('./totally-missing');",
      filename: file("pages/index/index.js"),
      options: [
        {
          projectConfigPath: PROJECT_CONFIG,
          checks: {
            pathExists: false,
            packageBoundary: false,
          },
        },
      ],
    },
    // 14. 独立分包内部互引
    {
      code: "require('./i1');",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
    },
    // 16. resolveAlias 通配前缀
    {
      code: "require('@/utils/util');",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 17. resolveAlias 精确匹配
    {
      code: "const u = require('~utils');",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 18. alias 配合 import 语法
    {
      code: "import x from '@/pages/detail/detail';",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 20. 子包经 alias 引用主包工具
    {
      code: "require('@/utils/util');",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
    },
    // 21a. 关闭 crossSubpackage 子开关后：分包 → 分包 静默
    {
      code: "require('/subB/pages/b1/b1');",
      filename: file("subA/pages/a1/a1.js"),
      options: opts({ checks: { crossSubpackage: false } }),
    },
    // 21b. 关闭 mainImportSubpackage 子开关后：主包 → 分包 静默
    {
      code: "require('/subA/components/foo/foo');",
      filename: file("pages/index/index.js"),
      options: opts({ checks: { mainImportSubpackage: false } }),
    },
    // 21c. 关闭 independentCross 子开关后：独立分包 → 外部 静默
    {
      code: "require('/utils/util');",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts({ checks: { independentCross: false } }),
    },
    // 21. .wxs 文件里的 require 解析到同目录其他 .wxs
    {
      code: "var shared = require('./shared.wxs');",
      filename: file("utils/main.wxs"),
      options: opts(),
    },
    // 22. .wxs 文件 require 无扩展名也能命中（resolver 兜 .wxs）
    {
      code: "var shared = require('./shared');",
      filename: file("utils/main.wxs"),
      options: opts(),
    },
    // 23a. 分包异步化 - callback 风格：分包 A → 分包 B（官方合法）
    {
      code: "require('/subB/pages/b1/b1', (mod) => { console.log(mod); });",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
    },
    // 23b. 分包异步化 - callback 风格：主包 → 分包（官方合法）
    {
      code: "require('/subA/components/foo/foo', (mod) => {}, ({errMsg}) => {});",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 23c. 分包异步化 - callback 风格：独立分包 → 主包（官方合法）
    {
      code: "require('/utils/util', (mod) => {});",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
    },
    // 23d. 分包异步化 - Promise 风格：require.async
    {
      code: "require.async('/subB/pages/b1/b1').then((mod) => {});",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
    },
    // 23e. async require 带 resolveAlias
    {
      code: "require('@/subA/components/foo/foo', (mod) => {});",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 24. ignorePatterns：匹配到的 request 整条跳过所有检查
    {
      code: "require('/subA/components/foo/foo');",
      filename: file("pages/index/index.js"),
      options: opts({ ignorePatterns: ["^/subA/"] }),
    },
    // 24b. ignorePatterns：多个正则，命中任一即跳过
    {
      code: "import x from './totally-missing';",
      filename: file("pages/index/index.js"),
      options: opts({
        ignorePatterns: ["no-match-here", "totally-missing$"],
      }),
    },
    // 24c. ignorePatterns：非法正则源码被静默忽略，不会让整个规则崩
    {
      code: "require('/utils/util');",
      filename: file("pages/index/index.js"),
      options: opts({ ignorePatterns: ["[bad-regex"] }),
    },
    // 25. 未配置 projectConfigPath 时，自动向上查找 project.config.json 定位 app.json
    {
      code: "require('/utils/util');",
      filename: file("pages/index/index.js"),
    },
  ],

  invalid: [
    // 1. 主包引用分包 (绝对路径)
    {
      code: "require('/subA/components/foo/foo');",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "mainImportSubpackage" }],
    },
    // 2. 主包引用分包 (相对路径)
    {
      code: "require('../../subA/components/foo/foo');",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "mainImportSubpackage" }],
    },
    // 3. 不存在的相对路径
    {
      code: "require('./nope/nope');",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 4. 不存在的绝对路径
    {
      code: "import x from '/not/exist';",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 5. 跨分包
    {
      code: "require('/subB/pages/b1/b1');",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
      errors: [{ messageId: "crossSubpackage" }],
    },
    // 6. 独立分包引用主包
    {
      code: "require('/utils/util');",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
      errors: [{ messageId: "independentCross" }],
    },
    // 7. 独立分包引用其他子包
    {
      code: "require('/subA/pages/a1/a1');",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
      errors: [{ messageId: "independentCross" }],
    },
    // 12. export from 缺失
    {
      code: "export { noop } from './does-not-exist';",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 13. projectConfigPath 指向不存在文件 → 应在文件级报一次
    {
      code: "require('./x');",
      filename: file("pages/index/index.js"),
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
    // 14. alias 展开后仍不存在 → notResolved，带原始 request
    {
      code: "require('@/not/exist');",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [
        { messageId: "notResolved", data: { request: "@/not/exist" } },
      ],
    },
    // 15. alias 展开后穿越分包边界 → 仍被 packageBoundary 捕获
    {
      code: "require('@/subA/components/foo/foo');",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "mainImportSubpackage" }],
    },
    // 16b. 分包异步化 - 路径写错仍然报 notResolved
    {
      code: "require('/subA/pages/does-not-exist', (mod) => {});",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 16c. require.async - 路径写错仍然报 notResolved
    {
      code: "require.async('/subA/pages/does-not-exist').then(mod => {});",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 17. .wxs 文件里 require 使用 alias → 原生 WXS 不支持，直接报 aliasNotSupportedInWxs
    {
      code: "var shared = require('@/utils/shared.wxs');",
      filename: file("utils/main.wxs"),
      options: opts(),
      errors: [
        {
          messageId: "aliasNotSupportedInWxs",
          data: { request: "@/utils/shared.wxs", alias: "@/" },
        },
      ],
    },
    // 18. .wxs 文件里 require 精确 alias（~utils）同样不合法
    {
      code: "var u = require('~utils');",
      filename: file("utils/main.wxs"),
      options: opts(),
      errors: [{ messageId: "aliasNotSupportedInWxs" }],
    },
    // 19. .wxs 文件里的 require 必须使用相对路径
    {
      code: "var shared = require('/utils/shared.wxs');",
      filename: file("utils/main.wxs"),
      options: opts(),
      errors: [
        {
          messageId: "wxsRequireNotRelative",
          data: { request: "/utils/shared.wxs" },
        },
      ],
    },
    // 20. .wxs 文件里的 require 只能解析 .wxs，不应兜到同名 .js
    {
      code: "var util = require('./util');",
      filename: file("utils/main.wxs"),
      options: opts(),
      errors: [
        {
          messageId: "notResolved",
          data: { request: "./util" },
        },
      ],
    },
    // 21. requireRelativePrefix 默认开启：不允许把本地路径写成裸路径
    {
      code: "require('utils/util');",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [
        {
          messageId: "relativePrefixRequired",
          data: { request: "utils/util" },
        },
      ],
    },
  ],
});
