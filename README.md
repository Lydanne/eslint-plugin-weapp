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

To use this plugin from Oxlint, add it under `jsPlugins`:

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

| Name                                 | Description             | 💼   | 🔧 |
| :----------------------------------- | :---------------------- | :--- | :- |
| [component](docs/rules/component.md) | 检查组件的 properties 属性是否规范 | 🧊 ✅ | 🔧 |

<!-- end auto-generated rules list -->
