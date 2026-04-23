const assert = require("node:assert/strict");
const path = require("node:path");
const { ESLint } = require("eslint");
const { defineConfig } = require("eslint/config");
const plugin = require("../../../lib");

const fixtureRoot = path.resolve(__dirname, "../../fixtures/miniprogram");

describe("recommended config", function () {
  it("exposes both legacy and flat recommended configs", function () {
    assert.ok(plugin.configs.recommended);
    assert.ok(Array.isArray(plugin.configs["flat/recommended"]));
    assert.ok(Array.isArray(plugin.configs["flat/weapp"]));
    assert.equal(typeof plugin.createFlatWeappConfig, "function");
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

  it("works with ESLint 10 flat/weapp config for mini program assets", async function () {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: defineConfig(plugin.configs["flat/weapp"]),
    });

    const [[jsonResult], [wxssResult], [wxmlResult]] = await Promise.all([
      eslint.lintText(
        `{ "usingComponents": { "missing": "/not/there" } }`,
        { filePath: path.join(fixtureRoot, "pages/index/index.json") },
      ),
      eslint.lintText(`@import "/ghost.wxss";`, {
        filePath: path.join(fixtureRoot, "pages/index/index.wxss"),
      }),
      eslint.lintText(`<import src="/no/where.wxml"/>`, {
        filePath: path.join(fixtureRoot, "pages/index/index.wxml"),
      }),
    ]);

    assert.equal(jsonResult.messages[0].ruleId, "weapp2/component-import");
    assert.equal(wxssResult.messages[0].ruleId, "weapp2/wxss-import");
    assert.equal(wxmlResult.messages[0].ruleId, "weapp2/wxml-import");
  });
});
