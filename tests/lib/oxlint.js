const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

describe("oxlint compatibility", function () {
  it("loads the plugin and reports diagnostics through oxlint", function () {
    const fixtureDir = path.resolve(__dirname, "../../fixtures/oxlint");
    const oxlintBin = path.resolve(__dirname, "../../node_modules/.bin/oxlint");
    const configPath = path.join(fixtureDir, ".oxlintrc.json");
    const filePath = path.join(fixtureDir, "component-invalid.js");

    let executionError;

    try {
      execFileSync(
        oxlintBin,
        ["-c", configPath, "--format", "json", filePath],
        {
          cwd: fixtureDir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      executionError = error;
    }

    assert.ok(executionError, "expected oxlint to report one lint error");
    assert.equal(executionError.status, 1);

    const result = JSON.parse(executionError.stdout);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "weapp2(component)");
    assert.match(result.diagnostics[0].message, /构造类型/);
  });
});
