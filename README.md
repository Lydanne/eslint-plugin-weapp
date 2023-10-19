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

Add `weapp` to the plugins section of your `.eslintrc` configuration file. You can omit the `eslint-plugin-` prefix:

```json
{
  "extends": ["eslint:recommended", "plugin:weapp2/recommended"]
}
```

## Rules

<!-- begin auto-generated rules list -->

💼 Configurations enabled in.\
✅ Set in the `recommended` configuration.\
🔧 Automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/user-guide/command-line-interface#--fix).

| Name                                 | Description                        | 💼  | 🔧  |
| :----------------------------------- | :--------------------------------- | :-- | :-- |
| [component](docs/rules/component.md) | 检查组件的 properties 属性是否规范 | ✅  | 🔧  |

<!-- end auto-generated rules list -->
