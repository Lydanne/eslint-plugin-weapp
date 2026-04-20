const assert = require("node:assert/strict");
const { ESLint } = require("eslint");
const { defineConfig } = require("eslint/config");
const plugin = require("../../../lib");

describe("recommended config", function () {
  it("exposes both legacy and flat recommended configs", function () {
    assert.ok(plugin.configs.recommended);
    assert.ok(Array.isArray(plugin.configs["flat/recommended"]));
  });

  it("works with ESLint 10 flat config extends", async function () {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: defineConfig([
        {
          files: ["**/*.js"],
          plugins: {
            weapp2: plugin,
          },
          extends: ["weapp2/recommended"],
        },
      ]),
    });

    const [result] = await eslint.lintText(
      `
        Component({
          properties: {
            title: "",
          },
        });
      `,
      { filePath: "component.js" },
    );

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].ruleId, "weapp2/component");
  });
});
