---
pageClass: rule-details
sidebarDepth: 0
title: weapp2/wxml-import
description: 基于 app.json 校验 WXML 模板中 import / include / wxs 的 src 引用路径
---

# weapp2/wxml-import

📝 基于 `app.json` 校验 **WXML** 模板中 `<import src>` / `<include src>` / `<wxs src>` 指向的目标文件是否存在，以及是否越过了小程序的分包边界。

<!-- end auto-generated rule header -->

## 机制

本插件为 ESLint 注册了一个极简的 **`weapp2/wxml` language**（零依赖的内置扫描器），只模型化我们关心的 `src` 属性：

- Program → SrcAttribute[]
- 动态绑定 `src="{{...}}"` 会被解析器跳过（规则看不到字面量即跳过）
- HTML 注释 `<!-- ... -->` 内的内容会被忽略（注释区里的 `<import>` 不算数）

因此 WXML 不走 processor，诊断行列精确。

## 配置

```js
// eslint.config.js
const path = require("node:path");
const weapp2 = require("eslint-plugin-weapp2");

module.exports = [
  ...weapp2.configs["flat/recommended"],
  {
    files: ["miniprogram/**/*.wxml"],
    language: "weapp2/wxml",
    plugins: { weapp2 },
    rules: {
      "weapp2/wxml-import": [
        "error",
        { appJsonPath: path.resolve(__dirname, "miniprogram/app.json") },
      ],
    },
  },
];
```

### 选项

| 选项                     | 类型       | 默认值                        | 说明                          |
| :----------------------- | :--------- | :---------------------------- | :---------------------------- |
| `appJsonPath`            | `string`   | —（必填）                     | `app.json` 路径               |
| `miniprogramRoot`        | `string`   | `path.dirname(appJsonPath)`   | 自定义小程序根                |
| `checks.pathExists`      | `boolean`  | `true`                        | 关闭后不再报未解析错误        |
| `checks.packageBoundary` | `boolean`  | `true`                        | 关闭后不再校验跨分包          |

此规则不接受 `extensions` 选项：

- `<import>` / `<include>` 固定补全 `.wxml`
- `<wxs>` 固定补全 `.wxs`

避免混淆跨扩展的同名文件。

## 检查项

1. **路径存在性** — `src` 指向的 `.wxml` / `.wxs` 文件能否解析（仅支持 `/`、`./`、`../`）。
2. **跨分包边界**：
   - 主包 WXML ↛ 分包资源
   - 分包 A ↛ 分包 B
   - 独立分包 ↛ 任何外部
3. **路径别名（resolveAlias）误用** — 原生 WXML 不支持 `app.json.resolveAlias`（开发者工具只在 JS 里做编译期替换）。若 `src` 命中别名前缀（如 `@/...`）→ `aliasNotSupported`。

## 示例

合法：

```html
<!-- miniprogram/pages/index/index.wxml -->
<import src="/templates/base.wxml"/>
<import src="../../templates/base"/>           <!-- 省略扩展名 -->
<!-- 注意：原生 WXML 不支持 `@/...` 别名，写了会被报 aliasNotSupported -->
<include src="/templates/slot.wxml"/>
<wxs src="/utils/shared.wxs" module="u"/>
<image src="{{url}}"/>                          <!-- 动态绑定不校验（但本规则也不管 <image>） -->
```

违规：

```html
<!-- miniprogram/pages/index/index.wxml  (主包页面) -->
<import src="/subA/pages/a1/a1.wxml"/>         <!-- 主包 → 分包 -->
```

```html
<!-- miniprogram/subA/pages/a1/a1.wxml  (subA) -->
<include src="/subB/templates/b.wxml"/>        <!-- 跨分包 -->
```

```html
<!-- miniprogram/subInd/pages/i1/i1.wxml  (独立分包) -->
<import src="/templates/base.wxml"/>           <!-- 独立分包 ↛ 外部 -->
```

```html
<!-- 任何 .wxml -->
<import src="/no/where.wxml"/>                  <!-- notResolved -->
<wxs src="./ghost" module="u"/>                 <!-- 省略扩展名也解析不到 -->
```

## 局限

- 只覆盖 `<import>` / `<include>` / `<wxs>` 的 `src`。`<image>` / `<audio>` 等标签的 `src` 常常是动态绑定、或指向 CDN 资源，默认不校验。
- 内置扫描器足以应对规范 WXML，但不是完整的 HTML5 parser；极端情况下（例如属性值里包含未转义的 `>`、多行展开）可能漏扫。若有这种奇特写法，请先修正 WXML 本身的可读性。
