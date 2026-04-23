# eslint-plugin-weapp2

a weapp eslint

## Installation

Install [ESLint](https://eslint.org/), this plugin, and the language plugins
used by the mini program asset rules:

```sh
npm install eslint eslint-plugin-weapp2 @eslint/json @eslint/css --save-dev
# pnpm install eslint eslint-plugin-weapp2 @eslint/json @eslint/css --save-dev
```

## Usage

For ESLint 10, use the bundled mini program flat config:

```js
const { defineConfig } = require("eslint/config");
const weapp2 = require("eslint-plugin-weapp2");

module.exports = defineConfig([
  ...weapp2.configs["flat/weapp"],
]);
```

If your config loader cannot synchronously `require()` `@eslint/json` or
`@eslint/css`, pass the language plugins explicitly:

```js
const { defineConfig } = require("eslint/config");
const weapp2 = require("eslint-plugin-weapp2");

module.exports = (async () => {
  const json = (await import("@eslint/json")).default;
  const css = (await import("@eslint/css")).default;

  return defineConfig([
    ...weapp2.createFlatWeappConfig({ json, css }),
  ]);
})();
```

`flat/weapp` enables:

- JS/WXS rules: `weapp2/component`, `weapp2/import`, `weapp2/wx-navigate`
- JSON rules through `@eslint/json`: `weapp2/component-import`
- WXSS rules through `@eslint/css`: `weapp2/wxss-import`
- WXML rules through the built-in `weapp2/wxml` language: `weapp2/wxml-import`

If you only want the JS/WXS rules, use `weapp2.configs["flat/recommended"]`.

If you're still on ESLint 8, you can keep using `.eslintrc`:

```json
{
  "extends": ["eslint:recommended", "plugin:weapp2/recommended"]
}
```

## Rules

<!-- begin auto-generated rules list -->

💼 Configurations enabled in.\
🧊 Set in the `flat/recommended` configuration.\
🌐 Set in the `flat/weapp` configuration.\
✅ Set in the `recommended` configuration.\
🔧 Automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/user-guide/command-line-interface#--fix).

| Name                                               | Description                                                                         | 💼      | 🔧 |
| :------------------------------------------------- | :---------------------------------------------------------------------------------- | :------ | :- |
| [component](docs/rules/component.md)               | 检查组件的 properties 属性是否规范                                                             | 🧊 🌐 ✅ | 🔧 |
| [component-import](docs/rules/component-import.md) | 基于 app.json 校验小程序组件配置文件中的路径（usingComponents / pages / tabBar 等）                     | 🌐      |    |
| [import](docs/rules/import.md)                     | 基于 app.json 检查小程序的 import/require 与动态跳转是否合法                                         | 🧊 🌐 ✅ |    |
| [wx-navigate](docs/rules/wx-navigate.md)           | 基于 app.json 校验 wx.navigateTo / redirectTo / switchTab / reLaunch 等跳转 API 的 url 是否合法 | 🧊 🌐 ✅ |    |
| [wxml-import](docs/rules/wxml-import.md)           | 基于 app.json 校验 WXML 中 <import>/<include>/<wxs> 的 src 路径与分包边界                        | 🌐      |    |
| [wxss-import](docs/rules/wxss-import.md)           | 基于 app.json 校验 WXSS 的 @import 引用路径与分包边界                                             | 🌐      |    |

<!-- end auto-generated rules list -->
