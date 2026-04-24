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

| 选项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `projectConfigPath` | `string` | 自动查找 `project.config.json` | `project.config.json` 绝对或相对路径 |
| `miniprogramRoot` | `string` | 解析后的 `app.json` 所在目录 | monorepo / 自定义根目录时覆盖 |
| `callees` | `Array<string \| CalleeSpec>` | `[]` | 自定义跳转调用的匹配清单，在**内置默认**之外追加。内置默认始终生效：`wx.navigateTo` / `wx.redirectTo` / `wx.switchTab` / `wx.reLaunch`（详见下文） |
| `checks.pathExists` | `boolean` | `true` | 关闭后不再报 `notResolved` |
| `requireRelativePrefix` | `boolean` | `true` | 相对跳转必须显式写 `./` 或 `../`，不允许省略为 `detail`；设为 `false` 可兼容裸相对跳转 |
| `ignorePatterns` | `string[]` | `[]` | 正则源码数组，匹配 `url` 原始字符串；命中任一即整条跳过。语义同 [`weapp2/import#ignorepatterns`](./import.md#ignorepatterns) |

### 内置默认

以下四个原生跳转 API **始终**被校验，无需配置：

- `wx.navigateTo({ url })`
- `wx.redirectTo({ url })`
- `wx.switchTab({ url })`
- `wx.reLaunch({ url })`

想追加的包装（包括 `wx.safeNavigateTo` 这种 `wx.*` 二次封装）全部通过 `callees` 配置，参见下文。

### 扩展 `callees`：覆盖任意包装（wx.\* 二次封装 / 模块 / 裸函数 / 实例方法 / 位置参数）

项目里若把跳转 API 封装成自己的 `wx.customNavigate` / 模块对象 / 裸函数 / 实例方法，或者参数形态不是 `{ url }`，用 `callees` 伸展。

**语义**：

- 每项可以是一个 **dot-path 字符串**，对调用链做**精确匹配**。`this` 作为特殊首段。默认从第一个对象参数的 `url` 键读取 url。
- 或者是对象 `{ match, url: { key?: string, arg?: number } }`：
  - `url.key` —— 从第一个对象参数的指定键读取（例如 `path`）。
  - `url.arg` —— 从第 `N` 个位置参数读取字符串字面量。
  - 两者互斥；都不提供则默认 `{ key: "url" }`。
- 结果与内置默认取**并集**；同一 dot-path + 同一 url 来源会去重。

**示例**：

```js
// eslint.config.js
"weapp2/wx-navigate": ["error", {
  callees: [
    // 0. wx.* 二次封装：wx.safeNavigateTo({ url })
    "wx.safeNavigateTo",

    // 1. 模块对象：router.navigateTo({ url })
    "router.navigateTo",
    "router.redirectTo",

    // 2. 裸函数：import { navigateTo } from '@/utils/router'; navigateTo({ url })
    "navigateTo",

    // 3. 实例方法：this.$router.push({ url })
    "this.$router.push",
    "this.$router.replace",

    // 4. 位置参数：router.go('/pages/x/x')
    { match: "router.go", url: { arg: 0 } },

    // 5. 自定义对象键：router.push({ path: '/pages/x/x' })
    { match: "router.push", url: { key: "path" } },

    // 6. 同一 match 多打混（对象参数或字符串参数都接受）
    { match: "router.open", url: { key: "url" } },
    { match: "router.open", url: { arg: 0 } },
  ],
}]
```

**识别规则**（保守以避免误报）：

- 调用链必须是**成员表达式或标识符**的链。`computed` 访问只在键是字符串字面量时接受（`a["b"]` 和 `a.b` 等价）。
- 不作作用域分析：`const r = router; r.navigateTo(...)` **不**会被匹配。也不支持通配 `*.navigateTo`，请把你实际用的路径列出来。
- url 参数是表达式 / 模板含插值 / 变量 → 规则安全跳过，不产生报告。
- 内置默认（四个 `wx.*`）不可禁用；项目里如果不再直接用这些 API，默认 matcher 也不会触发（无调用 = 无匹配）。若确需禁用直接 `wx.*` 调用，请用 `no-restricted-syntax` 等规则在其它层面控制。

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
| `router.navigateTo(...)` / `wx.safeNavigateTo(...)` 等自封装跳转 | 通过 `callees` 选项配置覆盖 |

## 局限

- 仅识别字面量或无插值模板字符串作为 `url`；运行时动态拼的 url 无法校验。
- `url` 不展开 `resolveAlias`：alias 只用于构建工具的静态 `import`，对运行时的跳转无效。
- 匹配基于语法链的精确形态（见 `callees` 识别规则）；`const r = router; r.navigateTo(...)`、`obj[expr]()` 这种经过变量中转或动态键的调用不被捕获。
