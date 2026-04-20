import { createRequire } from "node:module";
import { defineConfig } from "oxlint";

const require = createRequire(import.meta.url);
const weapp2OxlintPreset = require("eslint-plugin-weapp2/oxlint");

export default defineConfig({
  ...weapp2OxlintPreset,
});
