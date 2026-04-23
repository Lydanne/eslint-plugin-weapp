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

  it("applies globals by file type", async function () {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: defineConfig(plugin.configs["flat/recommended"]),
    });

    const [
      [wxsResult],
      [jsResult],
      [wxsWeappResult],
      [wxsRegExpResult],
      [wxsFunctionResult],
      [wxsEscapeResult],
      [wxsExportsResult],
    ] = await Promise.all([
      eslint.lintText(
        [
          "var date = getDate();",
          "var re = getRegExp('x');",
          "var parsed = JSON.parse('{\"n\":1}');",
          "console.log(Date.now(), Math.max(parsed.n, Number.MIN_VALUE));",
          "module.exports = { re: re, parsed: parsed, n: parseInt('1', 10) };",
          "require('./shared.wxs');",
        ].join("\n"),
        {
          filePath: path.join(fixtureRoot, "utils/global.wxs"),
        },
      ),
      eslint.lintText("getDate();", {
        filePath: path.join(fixtureRoot, "pages/index/index.js"),
      }),
      eslint.lintText("wx.getSystemInfoSync();", {
        filePath: path.join(fixtureRoot, "utils/no-wx.wxs"),
      }),
      eslint.lintText("RegExp('x');", {
        filePath: path.join(fixtureRoot, "utils/no-regexp.wxs"),
      }),
      eslint.lintText("Function('return 1')();", {
        filePath: path.join(fixtureRoot, "utils/no-function.wxs"),
      }),
      eslint.lintText("escape('x'); unescape('x');", {
        filePath: path.join(fixtureRoot, "utils/no-escape.wxs"),
      }),
      eslint.lintText("exports.value = 1;", {
        filePath: path.join(fixtureRoot, "utils/global.wxs"),
      }),
    ]);

    assert.deepEqual(wxsResult.messages, []);
    assert.equal(jsResult.messages.length, 1);
    assert.equal(jsResult.messages[0].ruleId, "no-undef");
    assert.match(jsResult.messages[0].message, /'getDate' is not defined/);
    assert.equal(wxsWeappResult.messages.length, 1);
    assert.equal(wxsWeappResult.messages[0].ruleId, "no-undef");
    assert.match(wxsWeappResult.messages[0].message, /'wx' is not defined/);
    assert.equal(wxsRegExpResult.messages.length, 1);
    assert.equal(wxsRegExpResult.messages[0].ruleId, "no-undef");
    assert.match(wxsRegExpResult.messages[0].message, /'RegExp' is not defined/);
    assert.equal(wxsFunctionResult.messages.length, 1);
    assert.equal(wxsFunctionResult.messages[0].ruleId, "no-undef");
    assert.match(
      wxsFunctionResult.messages[0].message,
      /'Function' is not defined/
    );
    assert.equal(wxsEscapeResult.messages.length, 2);
    assert.equal(wxsEscapeResult.messages[0].ruleId, "no-undef");
    assert.match(wxsEscapeResult.messages[0].message, /'escape' is not defined/);
    assert.equal(wxsEscapeResult.messages[1].ruleId, "no-undef");
    assert.match(
      wxsEscapeResult.messages[1].message,
      /'unescape' is not defined/
    );
    assert.equal(wxsExportsResult.messages.length, 1);
    assert.equal(wxsExportsResult.messages[0].ruleId, "no-undef");
    assert.match(wxsExportsResult.messages[0].message, /'exports' is not defined/);
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
