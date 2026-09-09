import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const checkScript = await readFile(new URL("./check.sh", import.meta.url), "utf8");
const appPackage = JSON.parse(await readFile(new URL("../app/package.json", import.meta.url), "utf8"));

test("the canonical quality gate runs the real workspace production build", () => {
  const typecheckCommand = "npm run typecheck --workspaces --if-present";
  const buildCommand = "node scripts/ci/build-artifact.mjs --workspace-build";
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

test("the build wrapper owns the exact workspace command and both visual consumers reuse its provenance", async () => {
  const [wrapper, visualBlocks, organizationViews] = await Promise.all([
    readFile(new URL("./ci/build-artifact.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/design/qa-visual-blocks.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/design/qa-org-views.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(wrapper, /\["run", "build", "--workspaces", "--if-present"\]/u);
  assert.match(wrapper, /GATE_BUILD_SOURCE_CHANGED/u);
  assert.match(wrapper, /prepareBuildOutput\(root\)/u);
  assert.match(wrapper, /if \(entry\.name === "cache"\) continue/u);
  assert.match(wrapper, /GATE_BUILD_OUTPUT_UNSAFE/u);
  assert.match(wrapper, /git", \["ls-files", "--others"/u);
  assert.match(visualBlocks, /ensureSharedBuildProvenance\(root\)/u);
  assert.match(organizationViews, /ensureSharedBuildProvenance\(root\)/u);
  assert.doesNotMatch(visualBlocks, /npm","run","build","--workspace","app/u);
  assert.doesNotMatch(organizationViews, /"run", "build", "--workspace", "app"/u);
});

test("pre-commit uses the staged fast gate while PR CI keeps the canonical full gate", async () => {
  const [workflow, hook, windowsLauncher] = await Promise.all([
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../.githooks/pre-commit", import.meta.url), "utf8"),
    readFile(new URL("./run-check-windows.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(workflow, /run:\s+\.\\scripts\\run-check-windows\.ps1/u);
  assert.match(windowsLauncher, /& \$resolved --noprofile --norc "scripts\/check\.sh"/u);
  assert.match(hook, /node "\$ROOT\/scripts\/ci\/fast-staged\.mjs"/u);
  assert.doesNotMatch(hook, /scripts\/check\.sh/u);
  assert.equal(workflow.match(/run:\s+\.\\scripts\\run-check-windows\.ps1/gu)?.length, 1);
});

test("resource-heavy PGlite suites leave the parallel pool but still run exactly once", () => {
  assert.equal(
    appPackage.scripts["test:gate"],
    "vitest run --exclude src/lib/boards/calculations.pglite.test.ts --exclude src/lib/boards/group-layout-persistence.pglite.test.ts && vitest run src/lib/boards/calculations.pglite.test.ts src/lib/boards/group-layout-persistence.pglite.test.ts --no-file-parallelism",
  );
});
