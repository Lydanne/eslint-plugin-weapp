---
pageClass: rule-details
sidebarDepth: 0
title: weapp2/wx-navigate
description: 基于 app.json 校验 wx.navigateTo / redirectTo / switchTab / reLaunch 等跳转 API 的 url
---

# weapp2/wx-navigate

📝 基于 app.json 校验 wx.navigateTo / redirectTo / switchTab / reLaunch 等跳转 API 的 url 是否合法.

💼 This rule is enabled in the following configs: 🧊 `flat/recommended`, 🌐 `flat/weapp`, ✅ `recommended`.

<!-- end auto-generated rule header -->

## 规则动机

小程序运行时通过 `wx.navigateTo` 等 API 做页面跳转时，只有**运行到那一行**才会暴露 url 写错的问题，反馈链路慢、踩坑代价高。对大多数跳转 url 都是**字面量**（或常量拼接）这一类，用静态分析完全可以前置捕获：

- url 指向的页面是否已在 `app.json` 的 `pages` / `subpackages` 中注册？
- 相对路径是否显式带了 `./` / `../` 前缀？

> **页面跳转不受分包限制**。微信小程序运行时允许主包 / 分包 / 独立分包之间任意用 `wx.navigateTo / redirectTo / switchTab / reLaunch` 跳转，目标分包会被按需下载。所以本规则**不做跨分包边界判定**。受分包边界约束的是静态依赖（JS `import/require`、`usingComponents`、`.wxss/.wxml` 的 `import`），请看 `weapp2/import`、`weapp2/component-import`、`weapp2/wxss-import`、`weapp2/wxml-import`。

静态分析的收益与 `weapp2/import` 相似，但判定对象是 **wx.\* 跳转 API** 的 `url`，所以拆为独立规则以便单独开关、单独配置、单独扩展自定义跳转封装。

## 检查项

1. **页面注册检查** — 字面 `url` 能否匹配到 `app.json` 的 `pages` / `subpackages[*].pages` 注册页面（会剥离 `?query` / `#hash`，支持绝对路径、相对路径和可选页面文件扩展名）。
2. **相对跳转前缀** — 默认要求显式带 `./` / `../`，防止裸文件名跳转带来的运行时歧义（详见 `requireRelativePrefix`）。

> **跳转 url 不支持 `resolveAlias`**。`wx.navigateTo / redirectTo / switchTab / reLaunch` 在微信小程序运行时**不会**展开 `@/*`、`~utils` 之类的别名前缀，所以本规则也不展开。写成 `@/pages/foo/foo` 的跳转会被当成非法路径，默认被 `relativePrefixRequired` 拦住；如果关闭了 `requireRelativePrefix`，则回落到 `notResolved`。这与 `weapp2/import` 的 alias 行为故意不同——`import` 走构建工具，alias 会被替换；跳转走运行时，alias 不生效。

动态表达式（`wx.navigateTo({ url })` / `wx.redirectTo({ url: someVar })` / 含插值的模板字符串）会被安全跳过，不产生任何报告，避免误报。

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
      "weapp2/wx-navigate": [
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

| 选项                     | 类型       | 默认值                                                      | 说明                                                           |
| :----------------------- | :--------- | :---------------------------------------------------------- | :------------------------------------------------------------- |
| `projectConfigPath`            | `string`   | 自动查找 `project.config.json`                              | `project.config.json` 绝对或相对路径                                      |
| `miniprogramRoot`        | `string`   | 解析后的 `app.json` 所在目录                                 | monorepo / 自定义根目录时覆盖                                  |
| `apis`                   | `string[]` | `['navigateTo','redirectTo','switchTab','reLaunch']`        | 需要校验的 `wx.*` 方法名；可扩展自定义跳转封装（见下）         |
| `checks.pathExists`      | `boolean`  | `true`                                                      | 关闭后不再报 `notResolved`                                     |
| `requireRelativePrefix`  | `boolean`  | `true`                                                      | 相对跳转必须显式写 `./` 或 `../`，不允许省略为 `detail`；设为 `false` 可兼容裸相对跳转 |
| `ignorePatterns`         | `string[]` | `[]`                                                        | 正则源码数组，匹配 `url` 原始字符串；命中任一即整条跳过。语义同 [`weapp2/import#ignorepatterns`](./import.md#ignorepatterns) |

### 扩展 `apis`：覆盖自定义跳转封装

如果团队内有对 `wx.navigateTo` 的二次封装（例如 `wx.safeNavigateTo`），加到 `apis` 即可：

```json
{
  "apis": ["navigateTo", "redirectTo", "switchTab", "reLaunch", "safeNavigateTo"]
}
```

规则只识别 `wx.<method>({ url: '...' })` 这一 pattern，变量承载的对象或者自定义的 `router.navigateTo(...)` 并不会被捕获 —— 这是规则在"误报 vs 漏报"之间的保守折中。

## 示例

违规：

```js
// miniprogram/pages/index/index.js
wx.navigateTo({ url: "/pages/not/found" });         // notResolved
wx.navigateTo({ url: "detail" });                   // relativePrefixRequired

// alias 在跳转 url 中不生效 → relativePrefixRequired
// （若关闭 requireRelativePrefix 则报 notResolved）
wx.redirectTo({ url: "@/subA/pages/a1/a1" });       // relativePrefixRequired
```

合法（包含跨分包跳转）：

```js
// 带 query / hash
wx.navigateTo({ url: "/pages/detail/detail?id=1" });
wx.navigateTo({ url: "/pages/detail/detail#foo" });
wx.navigateTo({ url: "../detail/detail" });

// 主包 → 分包 → 允许（分包按需下载）
wx.redirectTo({ url: "/subA/pages/a1/a1" });

// 分包 A → 分包 B → 允许
wx.navigateTo({ url: "/subB/pages/b1/b1" });

// 独立分包 ↔ 外部 → 允许
wx.reLaunch({ url: "/pages/index/index" });

// 分包 → 主包 → 允许
wx.navigateTo({ url: "/pages/index/index" });

// 动态 url / 模板字符串 / 变量承载 → 规则安全跳过，不产生报告
wx.navigateTo({ url });
wx.redirectTo({ url: `/pages/${name}/index` });
const p = "/pages/detail/detail";
wx.navigateTo({ url: p });
```

## 与 `weapp2/import` 的关系

| 场景 | 规则 |
| :--- | :--- |
| `import` / `require` / `export from` 的目标 | `weapp2/import` |
| `.wxs` 里的 `require` | `weapp2/import` |
| `wx.navigateTo / redirectTo / switchTab / reLaunch` 的 `url` | `weapp2/wx-navigate`（本规则） |
| `router.navigateTo(...)` / 自封装跳转 | 默认不管；通过 `apis` 扩展覆盖 wx.* 封装 |

## 局限

- 仅识别字面量或无插值模板字符串作为 `url`；运行时动态拼的 url 无法校验。
- 只识别对象字面量形态 `wx.navigateTo({ url: '...' })`；如果 `url` 藏在变量里、展开运算符里、外层函数返回值里，会被跳过。
- `url` 不展开 `resolveAlias`：alias 只用于构建工具的静态 `import`，对运行时的 `wx.*` 跳转无效。
- 自定义跳转封装（非 `wx.<method>`）需要通过 `apis` 配合来覆盖；对 `router.xxx`、`navigator.xxx` 目前不支持。
