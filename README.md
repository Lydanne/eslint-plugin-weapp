# eslint-plugin-weapp2

a weapp eslint

## Installation

You'll first need to install [ESLint](https://eslint.org/):

```sh
npm i eslint --save-dev
```

Next, install `eslint-plugin-weapp2`:

```sh
npm install eslint eslint-plugin-weapp2 --save-dev
# pnpm install eslint eslint-plugin-weapp2 --save-dev
```

## Usage

For ESLint 9 and ESLint 10, use a flat config file:

```js
const { defineConfig } = require("eslint/config");
const weapp2 = require("eslint-plugin-weapp2");

module.exports = defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {
      weapp2,
    },
    extends: ["weapp2/recommended"],
  },
]);
```

If you're still on ESLint 8, you can keep using `.eslintrc`:

```json
{
  "extends": ["eslint:recommended", "plugin:weapp2/recommended"]
}
```

To use this plugin from Oxlint with the bundled preset, create `oxlint.config.ts`:

```ts
import { defineConfig } from "oxlint";
import weapp2OxlintPreset from "eslint-plugin-weapp2/oxlint";

export default defineConfig({
  ...weapp2OxlintPreset,
});
```

The preset includes:

- `jsPlugins: ["eslint-plugin-weapp2"]`
- weapp globals such as `Component` and `wx`
- the plugin rule plus the matching Oxlint core rule overrides

If you prefer a JSON config, add this plugin manually under `jsPlugins`:

```json
{
  "jsPlugins": ["eslint-plugin-weapp2"],
  "rules": {
    "weapp2/component": "error"
  }
}
```

## Rules

<!-- begin auto-generated rules list -->

💼 Configurations enabled in.\
🧊 Set in the `flat/recommended` configuration.\
✅ Set in the `recommended` configuration.\
🔧 Automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/user-guide/command-line-interface#--fix).

| Name                                       | Description                                              | 💼   | 🔧 |
| :----------------------------------------- | :------------------------------------------------------- | :--- | :- |
| [component](docs/rules/component.md)       | 检查组件的 properties 属性是否规范                       | 🧊 ✅ | 🔧 |
| [import](docs/rules/import.md)             | 基于 app.json 校验 JS/WXS 的引用路径 / 分包边界 / 动态跳转 | 🧊 ✅ |    |
| [component-import](docs/rules/component-import.md) | 基于 app.json 校验组件配置路径（usingComponents / pages 等，需 `@eslint/json`） |      |    |
| [wxss-import](docs/rules/wxss-import.md)   | 基于 app.json 校验 WXSS 的 @import 路径（需 `@eslint/css`） |      |    |
| [wxml-import](docs/rules/wxml-import.md)   | 基于 app.json 校验 WXML 中 `<import>` / `<include>` / `<wxs>` 的 `src`（内置 `weapp2/wxml` 语言） |      |    |

<!-- end auto-generated rules list -->
