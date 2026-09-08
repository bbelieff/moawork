import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const checkScript = await readFile(new URL("./check.sh", import.meta.url), "utf8");
const appPackage = JSON.parse(await readFile(new URL("../app/package.json", import.meta.url), "utf8"));

test("the canonical quality gate runs the real workspace production build", () => {
  const typecheckCommand = "npm run typecheck --workspaces --if-present";
  const buildCommand = "npm run build --workspaces --if-present";
  const testCommand = "npm run test:gate --workspace app";
  const lines = checkScript.split(/\r?\n/u);

  for (const command of [typecheckCommand, buildCommand, testCommand]) {
    assert.equal(lines.filter((line) => line === command).length, 1, `${command} must appear exactly once`);
  }

  const typecheckAt = checkScript.indexOf(typecheckCommand);
  const buildAt = checkScript.indexOf(buildCommand);
  const testAt = checkScript.indexOf(testCommand);
  assert.ok(typecheckAt >= 0 && buildAt >= 0 && testAt >= 0, "all gate anchors must exist");
  assert.ok(typecheckAt < buildAt, "build must run after the cheaper static checks");
  assert.ok(buildAt < testAt, "build must fail before the long database test suite");
});

test("CI and pre-commit keep consuming the one canonical check script", async () => {
  const [workflow, hook, windowsLauncher] = await Promise.all([
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../.githooks/pre-commit", import.meta.url), "utf8"),
    readFile(new URL("./run-check-windows.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(workflow, /run:\s+\.\\scripts\\run-check-windows\.ps1/u);
  assert.match(windowsLauncher, /& \$resolved --noprofile --norc "scripts\/check\.sh"/u);
  assert.match(hook, /bash (?:"\$ROOT\/)?scripts\/check\.sh"?/u);
});

test("resource-heavy PGlite suites leave the parallel pool but still run exactly once", () => {
  assert.equal(
    appPackage.scripts["test:gate"],
    "vitest run --exclude src/lib/boards/calculations.pglite.test.ts --exclude src/lib/boards/group-layout-persistence.pglite.test.ts && vitest run src/lib/boards/calculations.pglite.test.ts src/lib/boards/group-layout-persistence.pglite.test.ts --no-file-parallelism",
  );
});
