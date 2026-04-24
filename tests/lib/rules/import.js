"use strict";

const path = require("node:path");
const { RuleTester } = require("eslint");

require("../../../lib");
const { clearCache } = require("../../../lib/import/app-json");
const { clearCache: clearPackageJsonCache } = require("../../../lib/import/package-json");
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

// 每次跑前清空 app.json / package.json 缓存，避免并行 mocha 进程状态互相干扰
clearCache();
clearPackageJsonCache();

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
    // 4. 子包 → 主包：相对路径允许
    {
      code: "require('../../../utils/util');",
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
    // 7b. 默认 packageJson 模式：package.json 里声明了 lodash 依赖 → 合法
    {
      code: "import _ from 'lodash';",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 7c. 默认 packageJson 模式：scoped 包只在 package.json 中声明
    //     （miniprogram_npm 里没有；miniprogramNpm 模式下这条应该报错，见 invalid 侧）
    {
      code: "import { foo } from '@wekit/shared';",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 7d. 默认 packageJson 模式：scoped 包 + 子路径
    {
      code: "require('@wekit/shared/sub/path');",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 7e. miniprogramNpm 模式（显式切回旧行为）：lodash 真实存在于 miniprogram_npm → 合法
    {
      code: "const _ = require('lodash');",
      filename: file("pages/index/index.js"),
      options: opts({ bareModuleResolution: "miniprogramNpm" }),
    },
    // 7f. 独立分包内使用 npm 包：该包存在于"独立分包自己的 miniprogram_npm"下 → 合法
    //     (packageJson 模式；subInd/miniprogram_npm/lodash 已单独构建)
    {
      code: "const _ = require('lodash');",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
    },
    // 7g. 同 7f，但 miniprogramNpm 模式——resolver 从 subInd 目录向上查找时先命中 subInd/miniprogram_npm
    {
      code: "const _ = require('lodash');",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts({ bareModuleResolution: "miniprogramNpm" }),
    },
    // 7h. 独立分包内 npm 未构建：默认会报 independentNpmNotSupported；
    //     关闭 checks.independentNpm 后不再报，让用户按自身工程情况放行
    {
      code: "import { foo } from '@wekit/shared';",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts({ checks: { independentNpm: false } }),
    },
    // 7i. auto 模式（默认）：miniprogram_npm 里实际构建了，但 package.json 里没声明 → 合法
    //     覆盖 monorepo 子包只维护 miniprogram_npm 不维护 package.json 的场景
    {
      code: "require('built-but-undeclared');",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 7j. 普通（非独立）分包内部也可以有自己的 miniprogram_npm：
    //     resolver 从 subA/pages/a1 向上查找时先命中 subA/miniprogram_npm/sub-only-pkg → 合法
    {
      code: "require('sub-only-pkg');",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
    },
    // 8. 动态 import() 配合 alias
    {
      code: "import('@/utils/util');",
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
      code: "require('../../../subB/pages/b1/b1');",
      filename: file("subA/pages/a1/a1.js"),
      options: opts({ checks: { crossSubpackage: false } }),
    },
    // 21b. 关闭 mainImportSubpackage 子开关后：主包 → 分包 静默
    {
      code: "require('../../subA/components/foo/foo');",
      filename: file("pages/index/index.js"),
      options: opts({ checks: { mainImportSubpackage: false } }),
    },
    // 21c. 关闭 independentCross 子开关后：独立分包 → 外部 静默
    {
      code: "require('../../../utils/util');",
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
      code: "require('../../../subB/pages/b1/b1', (mod) => { console.log(mod); });",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
    },
    // 23b. 分包异步化 - callback 风格：主包 → 分包（官方合法）
    {
      code: "require('../../subA/components/foo/foo', (mod) => {}, ({errMsg}) => {});",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 23c. 分包异步化 - callback 风格：独立分包 → 主包（官方合法）
    {
      code: "require('../../../utils/util', (mod) => {});",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
    },
    // 23d. 分包异步化 - Promise 风格：require.async
    {
      code: "require.async('../../../subB/pages/b1/b1').then((mod) => {});",
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
    //     只要命中 ignorePatterns，连绝对路径禁用检查也会静默
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
      code: "require('../../utils/util');",
      filename: file("pages/index/index.js"),
      options: opts({ ignorePatterns: ["[bad-regex"] }),
    },
    // 25. 未配置 projectConfigPath 时，自动向上查找 project.config.json 定位 app.json
    {
      code: "require('../../utils/util');",
      filename: file("pages/index/index.js"),
    },
  ],

  invalid: [
    // 1. JS 绝对路径 require → jsAbsolutePathNotSupported
    //    原来这里靠 /subA 测 mainImportSubpackage；新规则下绝对路径优先抦住（运行时也会爆）
    {
      code: "require('/subA/components/foo/foo');",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [
        {
          messageId: "jsAbsolutePathNotSupported",
          data: { request: "/subA/components/foo/foo" },
        },
      ],
    },
    // 1b. JS 绝对路径 import 声明 → jsAbsolutePathNotSupported
    {
      code: "import x from '/not/exist';",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [
        {
          messageId: "jsAbsolutePathNotSupported",
          data: { request: "/not/exist" },
        },
      ],
    },
    // 1c. JS 绝对路径 动态 import() → jsAbsolutePathNotSupported
    {
      code: "import('/utils/util');",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [
        {
          messageId: "jsAbsolutePathNotSupported",
          data: { request: "/utils/util" },
        },
      ],
    },
    // 1d. JS 绝对路径 分包异步化 require(path, cb) → jsAbsolutePathNotSupported
    //     异步化本身合法，但依然不能用绝对路径
    {
      code: "require('/subB/pages/b1/b1', (mod) => {});",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
      errors: [
        {
          messageId: "jsAbsolutePathNotSupported",
          data: { request: "/subB/pages/b1/b1" },
        },
      ],
    },
    // 1e. JS 绝对路径 require.async → jsAbsolutePathNotSupported
    {
      code: "require.async('/subB/pages/b1/b1').then(() => {});",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
      errors: [
        {
          messageId: "jsAbsolutePathNotSupported",
          data: { request: "/subB/pages/b1/b1" },
        },
      ],
    },
    // 2. 主包引用分包 (相对路径) → mainImportSubpackage
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
    // 5. 跨分包 (相对路径) → crossSubpackage
    {
      code: "require('../../../subB/pages/b1/b1');",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
      errors: [{ messageId: "crossSubpackage" }],
    },
    // 6. 独立分包引用主包 (相对路径) → independentCross
    {
      code: "require('../../../utils/util');",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
      errors: [{ messageId: "independentCross" }],
    },
    // 7. 独立分包引用其他子包 (相对路径) → independentCross
    {
      code: "require('../../../subA/pages/a1/a1');",
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
    // 16b. 分包异步化 - 路径写错 (相对路径) 仍然报 notResolved
    {
      code: "require('../../subA/pages/does-not-exist', (mod) => {});",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 16c. require.async - 路径写错 (相对路径) 仍然报 notResolved
    {
      code: "require.async('../../subA/pages/does-not-exist').then(mod => {});",
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
    // 22. 默认 packageJson 模式：未在 package.json 声明的裸包名 → relativePrefixRequired
    //     这里 miniprogram_npm 里也不存在 'not-declared-pkg'
    {
      code: "import x from 'not-declared-pkg';",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [
        {
          messageId: "relativePrefixRequired",
          data: { request: "not-declared-pkg" },
        },
      ],
    },
    // 23. miniprogramNpm 模式：scoped 包 package.json 里有声明，但 miniprogram_npm 里没有 → 按旧语义报错
    //     用来对照 valid 7c：同一个 request 在两种模式下结论不同
    {
      code: "import { foo } from '@wekit/shared';",
      filename: file("pages/index/index.js"),
      options: opts({ bareModuleResolution: "miniprogramNpm" }),
      errors: [
        {
          messageId: "relativePrefixRequired",
          data: { request: "@wekit/shared" },
        },
      ],
    },
    // 24. 独立分包内使用 npm 包但"独立分包自己的 miniprogram_npm"下没有 → 报 independentNpmNotSupported
    //     packageJson 模式：package.json 声明过 → 不会走 relativePrefixRequired；
    //     独立分包又无法用主包的 miniprogram_npm → 必须报这个新 messageId。
    {
      code: "import { foo } from '@wekit/shared';",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
      errors: [
        {
          messageId: "independentNpmNotSupported",
          data: {
            request: "@wekit/shared",
            from: "subInd",
            pkgName: "@wekit/shared",
          },
        },
      ],
    },
    // 25. 独立分包 + miniprogramNpm 模式：main-only-pkg 只在主包 miniprogram_npm 下构建（subInd 自己没有）
    //     → resolver 会命中主包副本，owner="" !== "subInd" → 报 independentNpmNotSupported
    {
      code: "require('main-only-pkg');",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts({ bareModuleResolution: "miniprogramNpm" }),
      errors: [
        {
          messageId: "independentNpmNotSupported",
          data: {
            request: "main-only-pkg",
            from: "subInd",
            pkgName: "main-only-pkg",
          },
        },
      ],
    },
    // 26. 同 25 但默认 auto 模式（main-only-pkg 在 package.json 已声明 → 不会报前缀错），
    //     独立分包仍只能读自己 miniprogram_npm → 同样报 independentNpmNotSupported
    {
      code: "require('main-only-pkg');",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
      errors: [
        {
          messageId: "independentNpmNotSupported",
          data: {
            request: "main-only-pkg",
            from: "subInd",
            pkgName: "main-only-pkg",
          },
        },
      ],
    },
    // 27. 显式 packageJson 模式：miniprogram_npm 里已构建但 package.json 里未声明 → 严格报前缀错。
    //     用来对照 valid 7i（auto 模式下同一 request 合法），验证 packageJson 模式不看 miniprogram_npm
    {
      code: "require('built-but-undeclared');",
      filename: file("pages/index/index.js"),
      options: opts({ bareModuleResolution: "packageJson" }),
      errors: [
        {
          messageId: "relativePrefixRequired",
          data: { request: "built-but-undeclared" },
        },
      ],
    },
  ],
});
