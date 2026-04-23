---
pageClass: rule-details
sidebarDepth: 0
title: weapp2/wxss-import
description: 基于 app.json 校验 WXSS 的 @import 路径
---

# weapp2/wxss-import

📝 基于 `app.json` 校验 **WXSS** 文件中 `@import` 的目标文件是否存在，以及是否跨越了小程序的分包边界。

> 微信小程序原生只识别 `.wxss`，不支持直接引入 `.css`。若你的构建链在中间产出 `.css`（如 taro 编译输出）可在 `extensions` 选项里自行加上。

<!-- end auto-generated rule header -->

## 前置要求

此规则基于 [**@eslint/css**](https://github.com/eslint/css) 提供的 CSSTree AST，因此你需要：

1. ESLint ≥ 9.15（flat config）。
2. 单独安装 `@eslint/css`（本插件将其声明为可选 peer dep）：

   ```bash
   npm i -D @eslint/css
   ```

3. 在 `eslint.config.js` 里给 `**/*.wxss` 启用 `css/css` 语言并挂载本规则。

> WXSS 相对标准 CSS 主要多了 `rpx` 单位。CSSTree 能原样解析，但如果你文件里混用了非标准语法（例如某些 PostCSS 扩展），建议把 `languageOptions.tolerant` 设为 `true`。

## 配置

```js
// eslint.config.js
const path = require("node:path");
const css = require("@eslint/css");
const weapp2 = require("eslint-plugin-weapp2");

module.exports = [
  ...weapp2.configs["flat/recommended"],
  {
    files: ["miniprogram/**/*.wxss"],
    language: "css/css",
    languageOptions: { tolerant: true },
    plugins: { css, weapp2 },
    rules: {
      "weapp2/wxss-import": [
        "error",
        { projectConfigPath: path.resolve(__dirname, "project.config.json") },
      ],
    },
  },
];
```

### 选项

| 选项                     | 类型       | 默认值                       | 说明                                        |
| :----------------------- | :--------- | :--------------------------- | :------------------------------------------ |
| `projectConfigPath`            | `string`   | 自动查找 `project.config.json` | `project.config.json` 路径                             |
| `miniprogramRoot`        | `string`   | 解析后的 `app.json` 所在目录  | 自定义小程序根                              |
| `extensions`             | `string[]` | `['.wxss']`                  | `@import` 省略扩展名时的补全顺序（如需支持 `.css` 自行追加） |
| `checks.pathExists`      | `boolean`  | `true`                       | 关闭后不再报未解析错误                      |
| `checks.packageBoundary` | `boolean`  | `true`                       | 关闭后不再校验跨分包                        |
| `ignorePatterns`         | `string[]` | `[]`                         | 正则源码数组，匹配 `@import` 路径原始字符串；命中任一即整条跳过。语义同 [`weapp2/import#ignorepatterns`](./import.md#ignorepatterns) |

## 检查项

1. **`@import "..."` 与 `@import url("...")`** 的目标能否解析到存在的 WXSS 文件（支持省略扩展名）。
2. **跨分包边界**：语义与 `weapp2/import` 一致：
   - 主包样式 ↛ 分包样式
   - 分包 A 样式 ↛ 分包 B 样式
   - 独立分包样式 ↛ 任何外部
3. **路径别名（resolveAlias）误用** — 原生微信小程序 WXSS 不支持 `app.json.resolveAlias`（开发者工具只在 JS 里做编译期替换）。`@import` 写 `@/...` 会编译失败；本规则在这种情况下直接报 `aliasNotSupported`，不再展开去检查目标是否存在。

远程 URL（`http://` / `https://` / `//` / `data:`）会被自动跳过。

## 示例

合法：

```css
/* miniprogram/pages/index/index.wxss */
@import "/styles/common.wxss";
@import "../../styles/theme.wxss";
/* 注意：原生 WXSS 不支持 `@/...` 别名；写了会被报 aliasNotSupported */
@import url("/styles/common.wxss");  /* url() 形态 */
```

违规：

```css
/* miniprogram/pages/index/index.wxss  (主包页面) */
@import "/subA/styles/a.wxss";       /* 主包不能引用分包 */
```

```css
/* miniprogram/subA/pages/a1/a1.wxss  (subA) */
@import "/subB/styles/b.wxss";       /* 跨分包 */
```

```css
/* miniprogram/subInd/pages/i1/i1.wxss  (独立分包) */
@import "/styles/common.wxss";       /* 独立分包不能引用外部 */
```

## 局限

- 只校验 `@import` 目标。声明中的 `url(...)`（例如 `background-image: url('/images/bg.png')`）暂不校验 —— 这需要额外的 `Url` 节点访问器与去重策略，计划在后续版本中加入。
- 依赖 `@eslint/css` 的 CSSTree 解析器，因此在 `tolerant: false` 模式下对 WXSS 的 `rpx` 与厂商扩展之外的奇异语法不友好。
