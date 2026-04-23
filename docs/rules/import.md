---
pageClass: rule-details
sidebarDepth: 0
title: weapp2/import
description: 基于 app.json 检查小程序 JS 文件的静态引用是否合法
---

# weapp2/import

📝 基于 app.json 检查小程序的 import/require 与动态跳转是否合法.

💼 This rule is enabled in the following configs: 🧊 `flat/recommended`, 🌐 `flat/weapp`, ✅ `recommended`.

<!-- end auto-generated rule header -->

## 规则动机

小程序的目录结构与 node 模块系统存在差异：

- 以 `/` 开头的路径相对于小程序根目录（而非文件系统根）。
- 裸模块名会被解析到 `miniprogram_npm/` 而非 `node_modules/`。
- 分包之间有严格的引用约束（主包 ↛ 分包；分包 ↛ 其它分包；独立分包 ↛ 外部）。
- 这些约束在构建前没有任何提示，踩坑后报错信息也很难定位。

本规则以 `app.json` 为真源，在 lint 阶段静态校验上述约束。

## 检查项

1. **路径存在性** — `import` / `require` / `import()` / `export from` 的目标能否解析到一个实际存在的文件（依次尝试原路径、补扩展名、目录 `index.*`）。
2. **跨分包边界**（同步 `require` / `import`）
   - 主包文件不能引用分包。
   - 普通分包之间不能互相引用。
   - 独立分包内的文件只能引用自身分包内的资源。
   - **例外**：[分包异步化](#分包异步化async-subpackage-loading) 形态（`require(path, cb)` / `require.async(path)`）是官方合法机制，会跳过此项校验，仅保留路径存在性。
3. **路径别名（resolveAlias）** — 识别 `app.json` 中配置的 `resolveAlias`，在上述两类检查之前先完成一次路径替换，替换结果继续走标准解析与分包边界判定。动态跳转的 alias 校验由 `weapp2/wx-navigate` 单独负责。
4. **`.wxs` 里的 WXS 模块引用** — 原生 WXS 的 `require` 只能引用 `.wxs` 文件模块，且必须使用相对路径；命中 `resolveAlias` 会报 `aliasNotSupportedInWxs`，写 `/...` 或裸模块名会报 `wxsRequireNotRelative`。

## 配置

此规则会优先使用 `projectConfigPath` 显式指定的 `project.config.json`；未配置时，会从当前被 lint 文件所在目录向上查找微信开发者工具的 `project.config.json`，并按其 `miniprogramRoot` 自动定位 `app.json`。如果两者都找不到，规则静默跳过。

### ESLint Flat Config

```js
// eslint.config.js
const path = require("node:path");
const weapp2 = require("eslint-plugin-weapp2");

module.exports = [
  {
    files: ["miniprogram/**/*.{js,ts,mjs,cjs}"],
    plugins: { weapp2 },
    rules: {
      "weapp2/import": [
        "error",
        {
          projectConfigPath: path.resolve(__dirname, "project.config.json"),
        },
      ],
    },
  },
];
```

### 选项表

| 选项                          | 类型       | 默认值                                     | 说明                                                                        |
| :---------------------------- | :--------- | :----------------------------------------- | :-------------------------------------------------------------------------- |
| `projectConfigPath`                 | `string`   | 自动查找 `project.config.json`             | `project.config.json` 的绝对或相对路径（相对于被 lint 的文件目录）                     |
| `miniprogramRoot`             | `string`   | 解析后的 `app.json` 所在目录                | 仅在 monorepo / 自定义目录结构下需要覆盖                                    |
| `extensions`                  | `string[]` | `['.js','.ts','.mjs','.cjs','.json','.wxs']` | 解析文件时按顺序尝试补全的扩展名                                          |
| `checks.pathExists`           | `boolean`  | `true`                                     | 关闭后不再报告未解析错误                                                    |
| `checks.packageBoundary`      | `boolean`  | `true`                                     | 父开关，关闭后下列三个子开关全部失效                                        |
| `checks.mainImportSubpackage` | `boolean`  | `true`                                     | 关闭后不再报"主包 → 分包"                                                   |
| `checks.crossSubpackage`      | `boolean`  | `true`                                     | 关闭后不再报"分包 A → 分包 B"                                               |
| `checks.independentCross`     | `boolean`  | `true`                                     | 关闭后不再报"独立分包 → 外部"                                               |
| `ignorePatterns`              | `string[]` | `[]`                                       | 正则源码数组，命中任一者对该引用完全静默（详见下文）                        |

## 路径别名（resolveAlias）

直接复用微信开发者工具在 `app.json` 中的 `resolveAlias` 配置：

```json
{
  "resolveAlias": {
    "@/*": "/*",
    "~utils": "/utils/util"
  }
}
```

规则匹配语义对齐开发者工具：

- **通配前缀** — key 与 value **同时**以 `/*` 结尾才视为通配；`"@/*": "/*"` 表示 `@/foo/bar` → `/foo/bar`。
- **完全匹配** — key 与 value 均不以 `/*` 结尾；`"~utils": "/utils/util"` 表示只有 `~utils` 本身会被替换。
- 一侧带 `*`、另一侧不带的非法配置会被安全忽略。

命中顺序：**精确匹配优先**，再按 key 长度从长到短匹配，避免短别名吃掉长别名。

替换之后：

- 结果一般以 `/` 开头，继续按小程序根目录解析（含扩展名补全、目录 `index.*` 兜底）。
- 继续参与 **跨分包边界** 检查：`@/subA/...` 从主包引用会被 `mainImportSubpackage` 捕获。
- 未解析的 alias（如 `@/not-exist`）仍报 `notResolved`，报告里携带原始 `request`（例如 `"@/not-exist"`）。
- 动态跳转的 alias 展开行为和报警由 [`weapp2/wx-navigate`](./wx-navigate.md) 负责。

> 注意：`.wxs` 文件里的 `require` 不使用上面的 `extensions` 配置，会固定按 `.wxs` 解析，以对齐官方 WXS 模块规则。

### 什么地方 **不** 展开 alias

原生微信小程序中，`resolveAlias` 只在 **JS（`.js` / `.ts` / `.mjs` / `.cjs`）** 编译阶段生效。其它文件类型写 `@/...` 小程序会编译失败：

| 文件类型 | 本插件的行为 |
| :--- | :--- |
| `.js` / `.ts` | 展开 alias ✅ |
| `.wxs` | 不展开，命中即报 `aliasNotSupportedInWxs`（见此规则） |
| `.wxml` | 不展开，由 `weapp2/wxml-import` 报 `aliasNotSupported` |
| `.wxss` | 不展开，由 `weapp2/wxss-import` 报 `aliasNotSupported` |
| `.json` | 不展开，由 `weapp2/component-import` 报 `aliasNotSupported` |

## 示例

以下示例假设 `app.json` 的 `subpackages` 含有 `subA`、`subB`（普通分包）与 `subInd`（`independent: true`）。

违规：

```js
// miniprogram/pages/index/index.js
require("/subA/components/foo/foo"); // 主包 → 分包，禁止

// miniprogram/subA/pages/a1/a1.js
require("/subB/pages/b1/b1"); // 分包 → 其它分包，禁止

// miniprogram/subInd/pages/i1/i1.js
require("/utils/util"); // 独立分包 → 主包，禁止
```

合法：

```js
// 主包相互引用
require("../../utils/util");
require("/utils/util");

// 分包内部
require("../../components/foo/foo");

// 分包 → 主包（非独立分包）
require("/utils/util");

// miniprogram_npm
const _ = require("lodash");

// WXS：只能相对引用其它 .wxs 模块
// miniprogram/utils/main.wxs
var shared = require("./shared.wxs");
```

WXS 违规：

```js
// miniprogram/utils/main.wxs
require("/utils/shared.wxs"); // 必须是相对路径
require("@/utils/shared.wxs"); // WXS 不支持 resolveAlias
require("./util"); // 只按 .wxs 解析，不会兜到同名 .js
```

## 分包异步化（Async Subpackage Loading）

微信官方自基础库 `2.11.2` 起支持 [分包异步化](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/async.html)，允许一个分包**合法地**加载其他分包的代码。规则识别两种形态，命中后**只校验路径存在性，跳过跨分包边界**：

### Callback 风格

```js
// subPackageA/pages/a1/a1.js
require('/subPackageB/utils', (mod) => {
  console.log(mod.whoami);
}, ({ mod, errMsg }) => {
  console.error(`path: ${mod}, ${errMsg}`);
});
```

判定条件：`require(path, cb, errCb?)`，即 `arguments.length >= 2`。

### Promise 风格

```js
// subPackageA/pages/a1/a1.js
require.async('/commonPackage/index').then((mod) => {
  mod.getPackageName();
}).catch(({ mod, errMsg }) => {
  console.error(`path: ${mod}, ${errMsg}`);
});
```

判定条件：`require.async(path)`。

### 什么仍然会被报

- **路径不存在**：`require('/subA/not-exist', cb)` 仍然报 `notResolved`（写错路径任何时候都是错）
- **语法不对**：`require.async('/subA/x').then(...)` 必须带 `.then`/`.catch` 才有意义，但规则只在语法层面识别 `require.async(path)`，不会深入检查回调处理。

### 为什么不为 async 加开关

async 是官方合法机制，默认跳过边界校验就是正确行为。想彻底禁止（包括 async）请改用 `checks.packageBoundary: false` 关整套跨分包校验，或者根据需要关对应子开关。

## ignorePatterns

正则字符串数组，匹配对象是 **request / url 原始字符串**（跟你代码里写的一样，不做任何 alias 展开或路径标准化）。命中任一正则即**整条**引用被静默，不会再走存在性、跨分包、alias 等任何检查。

```js
'weapp2/import': ['error', {
  projectConfigPath: path.resolve(__dirname, 'project.config.json'),
  ignorePatterns: [
    '^lodash$',             // 裸模块名精确匹配
    '^@foo/',               // scoped 包整组忽略
    '/__fixtures__/',       // 测试固件目录下的引用全不查
    '^wxfile://',           // 协议路径（插件默认已跳过，这里是演示语法）
  ],
}]
```

### 语义与注意事项

- 元素是**正则源码字符串**（不是 glob）。内部用 `new RegExp(source)` 编译。
- 命中即**一刀切静默**：不区分 `pathExists` / `packageBoundary` / `aliasNotSupportedInWxs`，全部跳过。
- 非法正则源码（如 `"[bad"`）会被**静默忽略**，不会让整个规则崩溃。
- **只对这个规则生效**。其它规则（`weapp2/wx-navigate` / `weapp2/component-import` / `weapp2/wxml-import` / `weapp2/wxss-import`）都各自独立配置 `ignorePatterns`。
- 想按**当前文件**忽略请用 ESLint 原生的 `overrides` / `ignorePatterns` 配置，本选项只作用于被引用的路径。

## 局限

- 仅支持字面量 / 无插值模板字符串作为路径；含有变量插值的引用会被跳过以避免误报。
- 动态跳转（`wx.navigateTo` / `redirectTo` / `switchTab` / `reLaunch`）的 `url` 请配套 [`weapp2/wx-navigate`](./wx-navigate.md) 规则。
- 组件配置 `usingComponents` / WXML `<import>` / WXSS `@import` 分别由 `weapp2/component-import` / `weapp2/wxml-import` / `weapp2/wxss-import` 负责。
- 分包异步化的回调函数只做语法层面识别（`arguments.length >= 2` 即视为 async），不深究第二个实参真的是函数。
