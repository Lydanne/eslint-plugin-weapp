---
pageClass: rule-details
sidebarDepth: 0
title: weapp2/wx-navigate
description: 基于 app.json 校验 wx.navigateTo / redirectTo / switchTab / reLaunch 等跳转 API 的 url
---

# weapp2/wx-navigate

📝 在 lint 阶段校验 `wx.navigateTo` / `wx.redirectTo` / `wx.switchTab` / `wx.reLaunch` 的 `url` 是否指向存在的小程序页面、是否违反跨分包边界。

💼 This rule is enabled in the following configs: 🧊 `flat/recommended`, ✅ `recommended`.

<!-- end auto-generated rule header -->

## 规则动机

小程序运行时通过 `wx.navigateTo` 等 API 做页面跳转时，只有**运行到那一行**才会暴露 url 写错或跨分包的问题，反馈链路慢、踩坑代价高。对大多数跳转 url 都是**字面量**（或常量拼接）这一类，用静态分析完全可以前置捕获：

- url 指向的页面是否真实存在？
- 主包页面试图 `wx.navigateTo` 到分包页面？分包 A 是否在 `switchTab` 到分包 B？
- 独立分包里 `reLaunch` 回了主包页面？

静态分析的收益与 `weapp2/import` 相似，但边界判定对象是 **wx.\* 跳转 API**，所以拆为独立规则以便单独开关、单独配置、单独扩展自定义跳转封装。

## 检查项

1. **路径存在性** — 字面 `url` 能否解析到一个真实存在的小程序页面（会剥离 `?query` / `#hash`、尝试扩展名补全与 `index.*` 兜底）。
2. **跨分包边界**
   - 主包页面不能跳转到分包页面 → `mainImportSubpackage`。
   - 分包 A 不能跳转到分包 B → `crossSubpackage`。
   - 独立分包不能跳转到任何外部页面 → `independentCross`。
3. **路径别名（resolveAlias）** — 如果你的构建工具链在 `wx.*` 第一参数里也做了 alias 编译替换，规则会**先展开再校验**，和 `weapp2/import` 的 alias 语义一致。原生微信运行时不认 alias，这种用法请在构建层确认真的会被替换。

动态表达式（`wx.navigateTo({ url })` / `wx.redirectTo({ url: someVar })` / 含插值的模板字符串）会被安全跳过，不产生任何报告，避免误报。

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
      "weapp2/wx-navigate": [
        "error",
        {
          appJsonPath: path.resolve(__dirname, "miniprogram/app.json"),
        },
      ],
    },
  },
];
```

### oxlint.config

```ts
module.exports = {
  jsPlugins: ["eslint-plugin-weapp2"],
  rules: {
    "weapp2/wx-navigate": [
      "error",
      {
        appJsonPath: require("path").resolve(
          __dirname,
          "miniprogram/app.json"
        ),
      },
    ],
  },
};
```

### 选项表

| 选项                     | 类型       | 默认值                                                      | 说明                                                           |
| :----------------------- | :--------- | :---------------------------------------------------------- | :------------------------------------------------------------- |
| `appJsonPath`            | `string`   | —（必填）                                                   | `app.json` 绝对或相对路径                                      |
| `miniprogramRoot`        | `string`   | `path.dirname(appJsonPath)`                                 | monorepo / 自定义根目录时覆盖                                  |
| `extensions`             | `string[]` | `['.js','.ts','.mjs','.cjs','.json','.wxs']`                | url 解析时的扩展名补全顺序                                     |
| `apis`                   | `string[]` | `['navigateTo','redirectTo','switchTab','reLaunch']`        | 需要校验的 `wx.*` 方法名；可扩展自定义跳转封装（见下）         |
| `checks.pathExists`      | `boolean`  | `true`                                                      | 关闭后不再报 `notResolved`                                     |
| `checks.packageBoundary` | `boolean`  | `true`                                                      | 父开关，关闭后下列三个子开关全部失效                           |
| `checks.mainImportSubpackage` | `boolean` | `true`                                                  | 关闭后不再报"主包 → 分包"                                      |
| `checks.crossSubpackage` | `boolean`  | `true`                                                      | 关闭后不再报"分包 A → 分包 B"                                  |
| `checks.independentCross` | `boolean` | `true`                                                      | 关闭后不再报"独立分包 → 外部"                                  |

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
// miniprogram/pages/index/index.js （主包）
wx.navigateTo({ url: "/pages/not/found" });         // notResolved
wx.redirectTo({ url: "/subA/pages/a1/a1" });        // mainImportSubpackage

// miniprogram/subA/pages/a1/a1.js （分包 A）
wx.switchTab({ url: "/subB/pages/b1/b1" });         // crossSubpackage

// miniprogram/subInd/pages/i1/i1.js （独立分包）
wx.reLaunch({ url: "/pages/index/index" });         // independentCross
```

合法：

```js
// 带 query / hash
wx.navigateTo({ url: "/pages/detail/detail?id=1" });
wx.navigateTo({ url: "/pages/detail/detail#foo" });

// 分包 → 主包（非独立）允许
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
- 自定义跳转封装（非 `wx.<method>`）需要通过 `apis` 配合来覆盖；对 `router.xxx`、`navigator.xxx` 目前不支持。
