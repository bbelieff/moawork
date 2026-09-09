#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_PATHS = ["app", "package.json", "package-lock.json"];
const VISUAL_ARTIFACT_FILES = [
  "BUILD_ID",
  "app-path-routes-manifest.json",
  "build-manifest.json",
  "prerender-manifest.json",
  "required-server-files.json",
  "routes-manifest.json",
];
const VISUAL_ARTIFACT_TREES = ["server", "static"];
const PROVENANCE_FILE = "moawork-visual-build-provenance.json";

function gateError(code, message, details = {}) {
  const error = new Error(`${code}:${message}`);
  error.code = code;
  error.details = details;
  return error;
}

function addFile(digest, root, relative) {
  const absolute = path.join(root, relative);
  digest.update(relative.replaceAll("\\", "/")).update("\0").update(readFileSync(absolute));
}

function addTree(digest, root, relative) {
  const absolute = path.join(root, relative);
  const entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) addTree(digest, root, child);
    else if (entry.isFile()) addFile(digest, root, child);
    else throw gateError("GATE_BUILD_ARTIFACT_UNSAFE", child);
  }
}

export function captureSourceIdentity(root) {
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const sourceDiff = execFileSync("git", ["diff", "--binary", "HEAD", "--", ...SOURCE_PATHS], {
    cwd: root,
    maxBuffer: 50 * 1024 * 1024,
  });
  const untrackedOutput = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", ...SOURCE_PATHS], {
    cwd: root,
    maxBuffer: 50 * 1024 * 1024,
  });
  const untracked = untrackedOutput.toString("utf8").split("\0").filter(Boolean).sort();
  const sourceDigest = createHash("sha256").update(commitSha).update("\0").update(sourceDiff);
  for (const relative of untracked) {
    const absolute = path.resolve(root, relative);
    const relativeFromRoot = path.relative(path.resolve(root), absolute);
    if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
      throw gateError("GATE_BUILD_SOURCE_UNTRACKED_UNSAFE", relative);
    }
    const metadata = lstatSync(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw gateError("GATE_BUILD_SOURCE_UNTRACKED_UNSAFE", relative);
    sourceDigest.update("\0untracked\0").update(relative.replaceAll("\\", "/")).update("\0").update(readFileSync(absolute));
  }
  const digest = sourceDigest.digest("hex");
  return { commitSha, sourceDigest: digest };
}

export function captureVisualArtifactIdentity(root) {
  const nextRoot = path.join(root, "app/.next");
  const digest = createHash("sha256");
  for (const relative of VISUAL_ARTIFACT_FILES) {
    const absolute = path.join(nextRoot, relative);
    try {
      if (!statSync(absolute).isFile()) throw gateError("GATE_BUILD_ARTIFACT_MISSING", relative);
    } catch (error) {
      if (error?.code === "GATE_BUILD_ARTIFACT_MISSING") throw error;
      throw gateError("GATE_BUILD_ARTIFACT_MISSING", relative);
    }
    digest.update(relative).update("\0").update(readFileSync(absolute));
  }
  for (const relative of VISUAL_ARTIFACT_TREES) addTree(digest, nextRoot, relative);
  return {
    buildId: readFileSync(path.join(nextRoot, "BUILD_ID"), "utf8").trim(),
    artifactDigest: digest.digest("hex"),
  };
}

export function captureBuildArtifact(root) {
  const visual = captureVisualArtifactIdentity(root);
  const combined = createHash("sha256").update(`app-next\0${visual.artifactDigest}\n`);
  const workerRelative = "worker/dist";
  try {
    addTree(combined, root, workerRelative);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    algorithm: "sha256(manifest-bytes+worker-dist)",
    buildId: visual.buildId,
    appDigest: visual.artifactDigest,
    digest: combined.digest("hex"),
  };
}

export function readVisualBuildProvenance(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, "app/.next", PROVENANCE_FILE), "utf8"));
  } catch {
    return null;
  }
}

export function provenanceMismatches(provenance, expected) {
  return ["commitSha", "sourceDigest", "buildId", "artifactDigest"]
    .filter((key) => !provenance || provenance[key] !== expected[key]);
}

function sameSource(left, right) {
  return left.commitSha === right.commitSha && left.sourceDigest === right.sourceDigest;
}

function sameArtifact(left, right) {
  return left.buildId === right.buildId && left.artifactDigest === right.artifactDigest;
}

function removeProvenance(root) {
  rmSync(path.join(root, "app/.next", PROVENANCE_FILE), { force: true });
}

function assertRealDirectory(absolute, label) {
  const metadata = lstatSync(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw gateError("GATE_BUILD_OUTPUT_UNSAFE", label);
}

export function prepareBuildOutput(root) {
  const resolvedRoot = path.resolve(root);
  const appRoot = path.resolve(resolvedRoot, "app");
  const nextRoot = path.resolve(appRoot, ".next");
  if (path.dirname(nextRoot) !== appRoot) throw gateError("GATE_BUILD_OUTPUT_UNSAFE", nextRoot);
  assertRealDirectory(resolvedRoot, "root");
  assertRealDirectory(appRoot, "app");
  if (!existsSync(nextRoot)) return;
  assertRealDirectory(nextRoot, "app/.next");
  const cache = path.join(nextRoot, "cache");
  if (existsSync(cache)) assertRealDirectory(cache, "app/.next/cache");
  for (const entry of readdirSync(nextRoot, { withFileTypes: true })) {
    if (entry.name === "cache") continue;
    const target = path.join(nextRoot, entry.name);
    if (entry.isSymbolicLink()) unlinkSync(target);
    else rmSync(target, { recursive: entry.isDirectory(), force: true });
  }
}

function writeProvenanceAtomically(root, provenance) {
  const nextRoot = path.join(root, "app/.next");
  mkdirSync(nextRoot, { recursive: true });
  const destination = path.join(nextRoot, PROVENANCE_FILE);
  const temporary = path.join(nextRoot, `.${PROVENANCE_FILE}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(provenance)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, destination);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function runNpmBuild(root, scope) {
  const npmArgs = scope === "workspace"
    ? ["run", "build", "--workspaces", "--if-present"]
    : ["run", "build", "--workspace", "app"];
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...npmArgs] : npmArgs;
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "inherit",
  });
  if (result.error) throw gateError("GATE_BUILD_SPAWN_FAILED", "production build could not start");
  if (result.status !== 0) {
    const error = gateError("GATE_BUILD_COMMAND_FAILED", `production build exited ${result.status ?? "without status"}`);
    error.exitCode = Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    throw error;
  }
}

export function buildWithVisualProvenance(root, { scope = "workspace", runBuild = runNpmBuild, afterProvenanceWrite } = {}) {
  if (!new Set(["workspace", "app"]).has(scope)) throw gateError("GATE_BUILD_SCOPE_INVALID", String(scope));
  const before = captureSourceIdentity(root);

  // Keep only Next's reusable cache. Every deployable output must be recreated, so
  // a successful no-op or partial command cannot bless stale bytes as a fresh build.
  prepareBuildOutput(root);
  try {
    runBuild(root, scope);
  } catch (error) {
    removeProvenance(root);
    throw error;
  }

  const after = captureSourceIdentity(root);
  if (!sameSource(before, after)) {
    removeProvenance(root);
    throw gateError("GATE_BUILD_SOURCE_CHANGED", "source identity changed while production build was running", { before, after });
  }

  const artifact = captureVisualArtifactIdentity(root);
  const provenance = { schemaVersion: 1, ...before, ...artifact };
  try {
    writeProvenanceAtomically(root, provenance);
    afterProvenanceWrite?.(root);
    const verifiedSource = captureSourceIdentity(root);
    const verifiedArtifact = captureVisualArtifactIdentity(root);
    const written = readVisualBuildProvenance(root);
    const mismatches = provenanceMismatches(written, { ...verifiedSource, ...verifiedArtifact });
    if (!sameSource(before, verifiedSource) || !sameArtifact(artifact, verifiedArtifact) || mismatches.length > 0) {
      throw gateError("GATE_BUILD_PROVENANCE_CHANGED", "source or artifact changed before provenance verification", { mismatches });
    }
    const combinedArtifact = captureBuildArtifact(root);
    const finalSource = captureSourceIdentity(root);
    const finalArtifact = captureVisualArtifactIdentity(root);
    if (!sameSource(before, finalSource) || !sameArtifact(artifact, finalArtifact)) {
      throw gateError("GATE_BUILD_PROVENANCE_CHANGED", "source or artifact changed during final receipt capture");
    }
    return { provenance, artifact: combinedArtifact };
  } catch (error) {
    removeProvenance(root);
    throw error;
  }
}

export function ensureLocalBuildProvenance(root, { runBuild = runNpmBuild } = {}) {
  const source = captureSourceIdentity(root);
  let artifact = null;
  try { artifact = captureVisualArtifactIdentity(root); } catch {}
  const expected = artifact ? { ...source, ...artifact } : null;
  const existing = readVisualBuildProvenance(root);
  if (expected && provenanceMismatches(existing, expected).length === 0) return existing;
  return buildWithVisualProvenance(root, { scope: "app", runBuild }).provenance;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  if (process.argv.length !== 3 || process.argv[2] !== "--workspace-build") {
    console.error('usage: node scripts/ci/build-artifact.mjs --workspace-build');
    process.exitCode = 64;
  } else {
    try {
      const result = buildWithVisualProvenance(path.resolve(import.meta.dirname, "../.."));
      console.log(`GATE_BUILD_PROVENANCE ${JSON.stringify(result)}`);
    } catch (error) {
      console.error(`GATE_BUILD_PROVENANCE_FAILURE ${JSON.stringify({ code: error?.code ?? "GATE_BUILD_INTERNAL" })}`);
      process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
    }
  }
}
