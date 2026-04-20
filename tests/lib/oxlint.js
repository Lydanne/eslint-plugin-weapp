const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function runOxlint(args, cwd) {
  const localOxlintBin = path.resolve(__dirname, "../../node_modules/.bin/oxlint");
  const hasLocalOxlint = fs.existsSync(localOxlintBin);
  const command = hasLocalOxlint ? localOxlintBin : process.platform === "win32" ? "npx.cmd" : "npx";
  const commandArgs = hasLocalOxlint ? args : ["-y", "oxlint@1.60.0", ...args];

  return execFileSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("oxlint compatibility", function () {
  this.timeout(30000);

  it("loads the plugin and reports diagnostics through oxlint", function () {
    const fixtureDir = path.resolve(__dirname, "../../fixtures/oxlint");
    const configPath = path.join(fixtureDir, ".oxlintrc.json");
    const filePath = path.join(fixtureDir, "component-invalid.js");

    let executionError;

    try {
      runOxlint(["-c", configPath, "--format", "json", filePath], fixtureDir);
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

  it("loads the exported oxlint preset through oxlint.config.ts", function () {
    const fixtureDir = path.resolve(__dirname, "../../fixtures/oxlint-preset");
    const configPath = path.join(fixtureDir, "oxlint.config.ts");
    const filePath = path.join(fixtureDir, "component-invalid.js");

    let executionError;

    try {
      runOxlint(["-c", configPath, "--format", "json", filePath], fixtureDir);
    } catch (error) {
      executionError = error;
    }

    assert.ok(executionError, "expected oxlint preset to report one lint error");
    assert.equal(executionError.status, 1);

    const result = JSON.parse(executionError.stdout);
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0].code, "weapp2(component)");
    assert.match(result.diagnostics[0].message, /构造类型/);
  });
});
