import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const weapp2OxlintPreset = require("eslint-plugin-weapp2/oxlint");

export default {
  ...weapp2OxlintPreset,
};
