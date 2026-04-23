---
pageClass: rule-details
sidebarDepth: 0
title: weapp2/json-import
description: 基于 app.json 校验小程序 JSON 配置文件中的路径字段
---

# weapp2/json-import

📝 基于 `app.json` 校验小程序 **JSON 配置文件** 中的路径字段：`usingComponents` / `componentGenerics` / `pages` / `subpackages[*].pages` / `tabBar.list[*].iconPath` / `themeLocation` / `sitemapLocation`。

<!-- end auto-generated rule header -->

## 前置要求

此规则基于 [**@eslint/json**](https://github.com/eslint/json) 提供的 JSON AST，因此你需要：

1. ESLint 9+（flat config）。
2. 单独安装 `@eslint/json`（本插件将其声明为可选 peer dep）：

   ```bash
   npm i -D @eslint/json
   ```

3. 在 `eslint.config.js` 里给 `**/*.json` 启用 `json/json` 语言并挂载本规则。

## 配置

```js
// eslint.config.js
const path = require("node:path");
const json = require("@eslint/json");
const weapp2 = require("eslint-plugin-weapp2");

module.exports = [
  ...weapp2.configs["flat/recommended"],
  {
    files: ["miniprogram/**/*.json"],
    language: "json/json",
    plugins: { json, weapp2 },
    rules: {
      "weapp2/json-import": [
        "error",
        { projectConfigPath: path.resolve(__dirname, "project.config.json") },
      ],
    },
  },
];
```

### 选项

选项形状与 [`weapp2/import`](./import.md) 一致，去掉 `checks.dynamic`：

| 选项                     | 类型       | 默认值                                       | 说明                                   |
| :----------------------- | :--------- | :------------------------------------------- | :------------------------------------- |
| `projectConfigPath`            | `string`   | 自动查找 `project.config.json`               | `project.config.json` 路径                        |
| `miniprogramRoot`        | `string`   | 解析后的 `app.json` 所在目录                  | 自定义小程序根                         |
| `extensions`             | `string[]` | `['.js','.ts','.mjs','.cjs','.json','.wxs']` | 解析组件路径时的扩展名补全顺序         |
| `checks.pathExists`      | `boolean`  | `true`                                       | 关闭后不再报未解析错误                 |
| `checks.packageBoundary` | `boolean`  | `true`                                       | 关闭后不再校验 `usingComponents` 跨分包 |
| `ignorePatterns`         | `string[]` | `[]`                                         | 正则源码数组，匹配 JSON 路径原始字符串；命中任一即整条跳过。语义同 [`weapp2/import#ignorepatterns`](./import.md#ignorepatterns) |

## 检查项与语义

| 字段                                        | 路径语义                          | 检查项                 |
| :------------------------------------------ | :-------------------------------- | :--------------------- |
| `usingComponents.<name>`                    | 小程序组件引用语义（支持 `/`、`./`、裸名 `miniprogram_npm`） | 路径存在 + 跨分包边界 |
| `componentGenerics.<name>.default`          | 同上                              | 路径存在 + 跨分包边界 |
| `pages[]`                                   | 小程序根的 page stem（不带扩展名） | 路径存在              |
| `subpackages[].pages[]` / `subPackages[].pages[]` | `<root> + "/" + stem`             | 路径存在              |
| `tabBar.list[].iconPath` / `selectedIconPath` | 小程序根的资源绝对路径            | 路径存在              |
| `themeLocation` / `sitemapLocation`         | 小程序根的资源绝对路径            | 路径存在              |

**跨分包边界只作用于 `usingComponents` / `componentGenerics.default`**；其它结构性字段（`pages` / `subpackages.pages` / `tabBar` / `themeLocation` / `sitemapLocation`）仅校验路径存在，因为它们本身就是对小程序结构的声明，讨论“跨分包”没有意义。

**路径别名（resolveAlias）误用**：原生微信小程序的 `.json` 配置不支持 `app.json.resolveAlias`（开发者工具只在 JS 里做编译期替换）。若 `usingComponents` / `componentGenerics.default` 的值命中别名前缀（例如 `@/...`） → `aliasNotSupported`，不再展开。

## 示例

合法：

```jsonc
// miniprogram/pages/index/index.json
{
  "usingComponents": {
    "hello": "/components/hello/hello",
    "card":  "../../components/card/card",
    "npm-btn": "weui-miniprogram/button/button"
  }
}
```

违规（示意）

JSON 里写别名（原生小程序不认）：

```jsonc
// miniprogram/pages/index/index.json
{
  "usingComponents": {
    "foo": "@/components/foo/foo"  // → aliasNotSupported
  }
}
```

跨分包：

```jsonc
// miniprogram/pages/index/index.json  （主包页面）
{
  "usingComponents": {
    "foo": "/subA/components/foo/foo"   // 主包不能引用分包
  }
}
```

```jsonc
// miniprogram/subA/pages/a1/a1.json  （subA 分包页面）
{
  "usingComponents": {
    "b1": "/subB/pages/b1/b1"           // 分包间不能互相引用
  }
}
```

```jsonc
// miniprogram/app.json
{
  "pages": [
    "pages/ghost/ghost"                 // 目标文件不存在
  ]
}
```
