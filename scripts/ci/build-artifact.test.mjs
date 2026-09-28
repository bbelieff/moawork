import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWithVisualProvenance,
  captureSourceIdentity,
  captureVisualArtifactIdentity,
  ensureLocalBuildProvenance,
  provenanceMismatches,
} from "./build-artifact.mjs";

const provenancePath = (root) => path.join(root, "app/.next/moawork-visual-build-provenance.json");

function makeRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "moawork-build-artifact-"));
  mkdirSync(path.join(root, "app"), { recursive: true });
  writeFileSync(path.join(root, "app/source.ts"), "export const value = 1;\n");
  writeFileSync(path.join(root, ".gitignore"), "app/.next/\n");
  writeFileSync(path.join(root, "package.json"), "{}\n");
  writeFileSync(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.email", "build-artifact@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Build Artifact Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  return root;
}

function writeArtifact(root, buildId) {
  const nextRoot = path.join(root, "app/.next");
  mkdirSync(nextRoot, { recursive: true });
  writeFileSync(path.join(nextRoot, "BUILD_ID"), `${buildId}\n`);
  for (const name of ["app-path-routes-manifest.json", "build-manifest.json", "prerender-manifest.json", "required-server-files.json", "routes-manifest.json"]) {
    writeFileSync(path.join(nextRoot, name), `${JSON.stringify({ buildId, name })}\n`);
  }
  mkdirSync(path.join(nextRoot, "server"), { recursive: true });
  mkdirSync(path.join(nextRoot, "static/chunks"), { recursive: true });
  writeFileSync(path.join(nextRoot, "server/app.js"), `server:${buildId}\n`);
  writeFileSync(path.join(nextRoot, "static/chunks/app.js"), `client:${buildId}\n`);
}

test("one successful build replaces stale output and writes exact reusable provenance", (t) => {
  const root = makeRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeArtifact(root, "stale-build");
  mkdirSync(path.join(root, "app/.next/cache"), { recursive: true });
  writeFileSync(path.join(root, "app/.next/cache/cache.bin"), "reusable-cache");
  writeFileSync(provenancePath(root), '{"commitSha":"stale"}\n');
  let builds = 0;
  const result = buildWithVisualProvenance(root, {
    runBuild(buildRoot, scope) {
      builds += 1;
      assert.equal(scope, "workspace");
      assert.equal(readFileSync(path.join(buildRoot, "app/.next/cache/cache.bin"), "utf8"), "reusable-cache");
      assert.equal(existsSync(path.join(buildRoot, "app/.next/BUILD_ID")), false, "stale deployable output must be gone");
      writeArtifact(buildRoot, "fresh-build");
    },
  });

  assert.equal(builds, 1);
  assert.equal(result.provenance.buildId, "fresh-build");
  assert.deepEqual(
    provenanceMismatches(result.provenance, { ...captureSourceIdentity(root), ...captureVisualArtifactIdentity(root) }),
    [],
  );
  const reused = ensureLocalBuildProvenance(root, { runBuild() { throw new Error("duplicate build"); } });
  assert.deepEqual(reused, result.provenance, "visual consumers must reuse the first verified build");
});

test("a failed build propagates its exit and leaves no reusable provenance", (t) => {
  const root = makeRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeArtifact(root, "stale-build");
  writeFileSync(provenancePath(root), '{"commitSha":"stale"}\n');
  const failure = Object.assign(new Error("expected failure"), { code: "GATE_BUILD_COMMAND_FAILED", exitCode: 17 });
  assert.throws(() => buildWithVisualProvenance(root, { runBuild() { throw failure; } }), (error) => error === failure);
  assert.equal(existsSync(provenancePath(root)), false);
});

test("a successful no-op cannot bless stale build files", (t) => {
  const root = makeRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeArtifact(root, "stale-build");
  assert.throws(
    () => buildWithVisualProvenance(root, { runBuild() {} }),
    /GATE_BUILD_ARTIFACT_MISSING/u,
  );
  assert.equal(existsSync(provenancePath(root)), false);
});

test("source mutation during build is rejected and cannot leave a green stamp", (t) => {
  const root = makeRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => buildWithVisualProvenance(root, {
      runBuild(buildRoot) {
        writeArtifact(buildRoot, "mutated-source-build");
        writeFileSync(path.join(buildRoot, "app/source.ts"), "export const value = 2;\n");
      },
    }),
    /GATE_BUILD_SOURCE_CHANGED/u,
  );
  assert.equal(existsSync(provenancePath(root)), false);
});

test("an untracked source created during build changes identity and leaves no stamp", (t) => {
  const root = makeRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => buildWithVisualProvenance(root, {
      runBuild(buildRoot) {
        writeArtifact(buildRoot, "untracked-source-build");
        writeFileSync(path.join(buildRoot, "app/new-source.ts"), "export const newValue = 1;\n");
      },
    }),
    /GATE_BUILD_SOURCE_CHANGED/u,
  );
  assert.equal(existsSync(provenancePath(root)), false);
});

test("compiled server or client mutation invalidates provenance and rebuilds", (t) => {
  const root = makeRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  buildWithVisualProvenance(root, { runBuild(buildRoot) { writeArtifact(buildRoot, "build-a"); } });
  writeFileSync(path.join(root, "app/.next/server/app.js"), "mutated-server\n");
  let builds = 0;
  const provenance = ensureLocalBuildProvenance(root, {
    runBuild(buildRoot, scope) {
      builds += 1;
      assert.equal(scope, "app");
      writeArtifact(buildRoot, "build-b");
    },
  });
  assert.equal(builds, 1);
  assert.equal(provenance.buildId, "build-b");
});

test("any source or artifact failure after atomic write removes the green stamp", (t) => {
  const root = makeRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(
    () => buildWithVisualProvenance(root, {
      runBuild(buildRoot) { writeArtifact(buildRoot, "build-a"); },
      afterProvenanceWrite(buildRoot) { rmSync(path.join(buildRoot, "app/.next/server/app.js")); },
    }),
    /GATE_BUILD_PROVENANCE_CHANGED/u,
  );
  assert.equal(existsSync(provenancePath(root)), false);
});

test("cleanup rejects a reparse .next and never touches its external target", (t) => {
  const root = makeRepository();
  const external = mkdtempSync(path.join(os.tmpdir(), "moawork-build-external-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  writeFileSync(path.join(external, "marker.txt"), "do-not-delete");
  try {
    symlinkSync(external, path.join(root, "app/.next"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`symlink/junction unavailable: ${error.code ?? error.message}`);
    return;
  }
  assert.throws(() => buildWithVisualProvenance(root, { runBuild() { throw new Error("must not start"); } }), /GATE_BUILD_OUTPUT_UNSAFE/u);
  assert.equal(readFileSync(path.join(external, "marker.txt"), "utf8"), "do-not-delete");
});

test("stale and mutated provenance never satisfy the current source and artifact identity", (t) => {
  const root = makeRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeArtifact(root, "build-a");
  const expected = { ...captureSourceIdentity(root), ...captureVisualArtifactIdentity(root) };
  for (const key of ["commitSha", "sourceDigest", "buildId", "artifactDigest"]) {
    assert.deepEqual(provenanceMismatches({ ...expected, [key]: "wrong" }, expected), [key]);
  }
});

test("the source identity contract is commit plus app/package diff bytes", (t) => {
  const root = makeRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = captureSourceIdentity(root);
  writeFileSync(path.join(root, "ignored.txt"), "outside source contract\n");
  assert.deepEqual(captureSourceIdentity(root), before);
  writeFileSync(path.join(root, "app/source.ts"), "export const value = 3;\n");
  const after = captureSourceIdentity(root);
  assert.equal(after.commitSha, before.commitSha);
  assert.notEqual(after.sourceDigest, before.sourceDigest);
});
