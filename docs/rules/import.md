---
pageClass: rule-details
sidebarDepth: 0
title: weapp2/import
description: 基于 app.json 检查小程序 JS 文件的静态引用是否合法
---

# weapp2/import

📝 基于 `app.json` 检查小程序 JS / WXS 文件的 **静态** 引用：路径存在性、跨分包边界，以及 `.wxs` 里 alias 误用。

🔄 `wx.navigateTo` / `redirectTo` / `switchTab` / `reLaunch` 等跳转类 API 的 `url` 校验已拆为独立规则 [`weapp2/wx-navigate`](./wx-navigate.md)。

💼 This rule is enabled in the following configs: 🧊 `flat/recommended`, ✅ `recommended`.

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
2. **跨分包边界**
   - 主包文件不能引用分包。
   - 普通分包之间不能互相引用。
   - 独立分包内的文件只能引用自身分包内的资源。
3. **路径别名（resolveAlias）** — 识别 `app.json` 中配置的 `resolveAlias`，在上述两类检查之前先完成一次路径替换，替换结果继续走标准解析与分包边界判定。动态跳转的 alias 校验由 `weapp2/wx-navigate` 单独负责。
4. **`.wxs` 里的 alias 误用** — 原生 WXS 不支持 `resolveAlias`；`.wxs` 文件里 `require('@/...')` 会报 `aliasNotSupportedInWxs`。

## 配置

此规则**必须**通过 `appJsonPath` 选项显式指定 `app.json` 的位置；未配置时规则静默跳过。

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
          appJsonPath: path.resolve(__dirname, "miniprogram/app.json"),
        },
      ],
    },
  },
];
```

### 选项表

| 选项                          | 类型       | 默认值                                     | 说明                                                                        |
| :---------------------------- | :--------- | :----------------------------------------- | :-------------------------------------------------------------------------- |
| `appJsonPath`                 | `string`   | —（必填，否则规则静默跳过）                | `app.json` 的绝对或相对路径（相对于被 lint 的文件目录）                     |
| `miniprogramRoot`             | `string`   | `path.dirname(appJsonPath)`                | 仅在 monorepo / 自定义目录结构下需要覆盖                                    |
| `extensions`                  | `string[]` | `['.js','.ts','.mjs','.cjs','.json','.wxs']` | 解析文件时按顺序尝试补全的扩展名                                          |
| `checks.pathExists`           | `boolean`  | `true`                                     | 关闭后不再报告未解析错误                                                    |
| `checks.packageBoundary`      | `boolean`  | `true`                                     | 关闭后不再校验跨分包                                                        |

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

### 什么地方 **不** 展开 alias

原生微信小程序中，`resolveAlias` 只在 **JS（`.js` / `.ts` / `.mjs` / `.cjs`）** 编译阶段生效。其它文件类型写 `@/...` 小程序会编译失败：

| 文件类型 | 本插件的行为 |
| :--- | :--- |
| `.js` / `.ts` | 展开 alias ✅ |
| `.wxs` | 不展开，命中即报 `aliasNotSupportedInWxs`（见此规则） |
| `.wxml` | 不展开，由 `weapp2/wxml-import` 报 `aliasNotSupported` |
| `.wxss` | 不展开，由 `weapp2/wxss-import` 报 `aliasNotSupported` |
| `.json` | 不展开，由 `weapp2/json-import` 报 `aliasNotSupported` |

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
```

## 局限

- 仅支持字面量 / 无插值模板字符串作为路径；含有变量插值的引用会被跳过以避免误报。
- 动态跳转（`wx.navigateTo` / `redirectTo` / `switchTab` / `reLaunch`）的 `url` 请配套 [`weapp2/wx-navigate`](./wx-navigate.md) 规则。
- JSON `usingComponents` / WXML `<import>` / WXSS `@import` 分别由 `weapp2/json-import` / `weapp2/wxml-import` / `weapp2/wxss-import` 负责。
