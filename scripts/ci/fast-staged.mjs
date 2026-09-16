#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FAST_GATE_LIMIT_MS = 120_000;
// Guardian changes run the complete Windows process-containment integration
// suite. Keep its cold-start budget separate from ordinary staged app checks.
export const GATE_LEASE_FAST_GATE_LIMIT_MS = 300_000;

function git(args, root = ROOT) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function validateRepoPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096
    || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("FAST_GATE_PATH_UNSAFE");
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("-"))) {
    throw new Error("FAST_GATE_PATH_UNSAFE");
  }
  return value;
}

export function parseGitNameStatusZ(raw) {
  const value = String(raw ?? "");
  if (!value) return [];
  const tokens = value.split("\0");
  if (tokens.pop() !== "") throw new Error("FAST_GATE_NAME_STATUS_TERMINATOR");
  const paths = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const renameOrCopy = /^[RC]\d{1,3}$/u.test(status);
    if (!renameOrCopy && !/^[ADMTUXB]$/u.test(status)) throw new Error("FAST_GATE_NAME_STATUS_INVALID");
    const count = renameOrCopy ? 2 : 1;
    if (index + count > tokens.length) throw new Error("FAST_GATE_NAME_STATUS_PATH_MISSING");
    for (let offset = 0; offset < count; offset += 1) paths.push(validateRepoPath(tokens[index++]));
  }
  return [...new Set(paths)].sort();
}

const allowedIgnoredSegments = new Set([
  "node_modules", ".next", "coverage", ".nyc_output", ".cache", ".parcel-cache",
  ".npm", "dist", "out", ".output", ".nuxt", ".svelte-kit", ".vite",
  ".vitepress", ".docusaurus", ".serverless", ".firebase", ".grunt", ".pnpm-store",
]);
const declaredDotenvNames = new Set([
  ".env", ".env.local", ".env.development", ".env.development.local",
  ".env.test", ".env.test.local", ".env.production", ".env.production.local",
]);
const canonicalNextEnv = [
  '/// <reference types="next" />',
  '/// <reference types="next/image-types/global" />',
  'import "./.next/types/routes.d.ts";',
  "",
  "// NOTE: This file should not be edited",
  "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
  "",
].join("\n");
const canonicalNextDevEnv = canonicalNextEnv.replace(
  'import "./.next/types/routes.d.ts";',
  'import "./.next/dev/types/routes.d.ts";',
);

export function isKnownIgnoredOutput(value) {
  const repoPath = String(value ?? "");
  if (!repoPath || repoPath.length > 4096 || repoPath.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(repoPath)) throw new Error("FAST_GATE_PATH_UNSAFE");
  const segments = repoPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("FAST_GATE_PATH_UNSAFE");
  }
  if (segments.some((segment) => allowedIgnoredSegments.has(segment))) return true;
  if ((segments.length === 1 || (segments.length === 2 && ["app", "worker"].includes(segments[0])))
    && declaredDotenvNames.has(segments.at(-1))) return true;
  validateRepoPath(repoPath);
  if (repoPath.startsWith(".yarn/") || repoPath.startsWith("supabase/.temp/")
    || repoPath.startsWith("supabase/.branches/") || repoPath.startsWith("_shots640/")
    || repoPath === "app/next-env.d.ts"
    || /^docs\/design\/round-BBE-148\/[^/]+\.html$/u.test(repoPath)
    || repoPath === "tools/board/fuel.json") return true;
  return /(?:^|\/)(?:[^/]+\.log|[^/]+\.pid|[^/]+\.pid\.lock|[^/]+\.tsbuildinfo|\.eslintcache)$/u.test(repoPath);
}

export function assertKnownIgnoredInputSafe(root, repoPath) {
  if (!isKnownIgnoredOutput(repoPath)) return false;
  if (repoPath !== "app/next-env.d.ts") return true;
  const target = path.resolve(root, repoPath);
  let metadata;
  try {
    const rootMetadata = lstatSync(path.resolve(root));
    const appMetadata = lstatSync(path.resolve(root, "app"));
    metadata = lstatSync(target);
    const contents = readFileSync(target, "utf8");
    const canonical = [canonicalNextEnv, canonicalNextDevEnv]
      .some(expected => contents === expected || contents === expected.replaceAll("\n", "\r\n"));
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()
      || !appMetadata.isDirectory() || appMetadata.isSymbolicLink()
      || !metadata.isFile() || metadata.isSymbolicLink() || !canonical) {
      throw new Error("FAST_GATE_IGNORED_INPUT");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "FAST_GATE_IGNORED_INPUT") throw error;
    throw new Error("FAST_GATE_IGNORED_INPUT", { cause: error });
  }
  return true;
}

function parseGitPathsZ(raw) {
  const value = String(raw ?? "");
  if (!value) return [];
  const paths = value.split("\0");
  if (paths.pop() !== "") throw new Error("FAST_GATE_IGNORED_PATH_TERMINATOR");
  return paths;
}

export function readExactStagedSnapshot(root = ROOT) {
  const unstaged = spawnSync("git", ["diff", "--quiet", "--ignore-submodules", "--"], { cwd: root });
  if (unstaged.error || unstaged.status !== 0) throw new Error("FAST_GATE_UNSTAGED_TRACKED_INPUT");
  if (git(["ls-files", "--others", "--exclude-standard", "-z"], root)) {
    throw new Error("FAST_GATE_UNTRACKED_INPUT");
  }
  const unsafeIgnored = parseGitPathsZ(git(["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], root))
    .find((repoPath) => !assertKnownIgnoredInputSafe(root, repoPath));
  if (unsafeIgnored) throw new Error("FAST_GATE_IGNORED_INPUT");
  const paths = parseGitNameStatusZ(git(["diff", "--cached", "--name-status", "-z"], root));
  if (paths.length === 0) throw new Error("FAST_GATE_EMPTY_INDEX");
  return {
    head: git(["rev-parse", "HEAD"], root).trim(),
    tree: git(["write-tree"], root).trim(),
    paths,
  };
}

export function assertStagedSnapshotUnchanged(initial, final) {
  if (initial?.head !== final?.head || initial?.tree !== final?.tree
    || JSON.stringify(initial?.paths) !== JSON.stringify(final?.paths)) {
    throw new Error("FAST_GATE_STAGED_TREE_DRIFT");
  }
  return true;
}

const appPath = (value) => value.startsWith("app/") || value === "package.json" || value === "package-lock.json";
const workerPath = (value) => value.startsWith("worker/") || value === "package.json" || value === "package-lock.json";
const gatePath = (value) => value === "AGENTS.md" || value === "CLAUDE.md"
  || value === ".githooks/pre-commit" || value === ".github/workflows/ci.yml"
  || value.startsWith("scripts/");
const visualGatePath = (value) => value === "docs/design/qa-visual-blocks.mjs"
  || value === "docs/design/qa-visual-gate-completion.mjs"
  || value === "docs/design/qa-visual-gate-completion.test.mjs";

export function buildFastGatePlan(paths) {
  const exact = [...new Set(paths.map(validateRepoPath))].sort();
  if (exact.length === 0) throw new Error("FAST_GATE_EMPTY_INDEX");
  return {
    paths: exact,
    app: exact.some(appPath),
    worker: exact.some(workerPath),
    migration: exact.some((value) => /^supabase\/migrations\/[^/]+\.sql$/u.test(value)),
    gate: exact.some(gatePath),
    gateLease: exact.some((value) => value.startsWith("scripts/gate-lease")),
    visualGate: exact.some(visualGatePath),
  };
}

export function fastGateLimitFor(paths) {
  return buildFastGatePlan(paths).gateLease ? GATE_LEASE_FAST_GATE_LIMIT_MS : FAST_GATE_LIMIT_MS;
}

function adjacentTests(paths, workspace, root = ROOT) {
  const prefix = `${workspace}/`;
  const result = new Set();
  for (const repoPath of paths.filter((value) => value.startsWith(prefix))) {
    const relative = repoPath.slice(prefix.length);
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(relative) && existsSync(path.join(root, workspace, relative))) {
      result.add(relative);
    }
    const match = relative.match(/^(.*)\.[cm]?[jt]sx?$/u);
    if (!match) continue;
    for (const suffix of [".test.ts", ".test.tsx", ".test.mjs", ".spec.ts", ".spec.tsx"]) {
      const candidate = `${match[1]}${suffix}`;
      if (existsSync(path.join(root, workspace, candidate))) result.add(candidate);
    }
  }
  return [...result].sort();
}

export function commandsFor(paths, root = ROOT) {
  const plan = buildFastGatePlan(paths);
  const commands = [
    { file: "git", args: ["diff", "--cached", "--check"], label: "staged whitespace" },
    { file: process.execPath, args: ["scripts/check-customer-specific-values.mjs"], label: "customer-specific values" },
    { file: process.execPath, args: ["scripts/check-production-repo-boundaries.mjs"], label: "production boundaries" },
  ];

  if (plan.migration) {
    commands.push(
      { file: process.execPath, args: ["--test", "scripts/check-migration-guards.test.mjs", "scripts/migration-deploy-gate.test.mjs"], label: "migration contract tests" },
      { file: process.execPath, args: ["scripts/check-migration-guards.mjs"], label: "migration chain" },
    );
  }

  if (plan.app) {
    commands.push(
      { file: process.execPath, args: ["scripts/check-css-token-references.mjs"], label: "CSS tokens" },
      { file: process.execPath, args: ["scripts/check-use-server-exports.mjs"], label: "server exports" },
      { file: process.execPath, args: ["scripts/check-server-client-boundary.mjs"], label: "server/client boundary" },
      { file: "npm", args: ["run", "typecheck", "--workspace", "app"], label: "app typecheck" },
    );
    const lintPaths = paths.filter((value) => /^app\/.*\.[cm]?[jt]sx?$/u.test(value) && existsSync(path.join(root, value)))
      .map((value) => `./${value.slice(4)}`);
    if (lintPaths.length) {
      commands.push({ file: "npm", args: ["exec", "--workspace", "app", "--", "eslint", "--", ...lintPaths], label: "changed app lint" });
    }
    const tests = adjacentTests(paths, "app", root);
    if (tests.length) {
      commands.push({
        file: "npm",
        args: ["exec", "--workspace", "app", "--", "vitest", "run", ...tests.map((value) => `./${value}`), "--maxWorkers=2"],
        label: "adjacent app tests",
      });
    }
  }

  if (plan.worker) {
    commands.push({ file: "npm", args: ["run", "typecheck", "--workspace", "worker"], label: "worker typecheck" });
    const lintPaths = paths.filter((value) => /^worker\/.*\.[cm]?[jt]sx?$/u.test(value) && existsSync(path.join(root, value)))
      .map((value) => `./${value.slice(7)}`);
    if (lintPaths.length) {
      commands.push({ file: "npm", args: ["exec", "--workspace", "worker", "--", "eslint", "--", ...lintPaths], label: "changed worker lint" });
    }
    const tests = adjacentTests(paths, "worker", root);
    if (tests.length) {
      commands.push({
        file: "npm",
        args: ["exec", "--workspace", "worker", "--", "vitest", "run", ...tests.map((value) => `./${value}`), "--maxWorkers=2"],
        label: "adjacent worker tests",
      });
    }
  }

  if (plan.gate) {
    commands.push({
      file: process.execPath,
      args: ["--test", "scripts/ci/fast-staged.test.mjs", "scripts/check-build-gate.test.mjs", "scripts/check-shell-entry.test.mjs"],
      label: "gate source contract",
    });
  }
  if (plan.gateLease) {
    commands.push({ file: process.execPath, args: ["--test", "scripts/gate-lease.test.mjs"], label: "gate lease contract" });
  }
  if (plan.visualGate) {
    commands.push({
      file: process.execPath,
      args: ["--test", "docs/design/qa-visual-gate-completion.test.mjs"],
      label: "visual completion contract",
    });
  }
  for (const repoPath of paths.filter((value) => value.endsWith(".mjs")
    && !value.endsWith(".test.mjs") && existsSync(path.join(root, value)))) {
    commands.push({ file: process.execPath, args: ["--check", repoPath], label: `syntax ${repoPath}` });
  }
  return commands;
}

function commandInvocation(file, args) {
  if (process.platform !== "win32" || file !== "npm") return { file, args };
  const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!existsSync(npmCli)) throw new Error("FAST_GATE_NPM_CLI_NOT_FOUND");
  return { file: process.execPath, args: [npmCli, ...args] };
}

function terminateTree(child, force = false) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    if (child.exitCode !== null) return;
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    if (child.exitCode === null) child.kill();
    return;
  }
  const signal = force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-child.pid, signal);
  } catch {
    if (child.exitCode === null) child.kill(signal);
  }
}

export async function runCommand({ file, args, label, cwd = ROOT, timeoutMs, signal }) {
  if (signal?.aborted) throw new Error(`FAST_GATE_INTERRUPTED:${signal.reason || "ABORT"}`);
  const invocation = commandInvocation(file, args);
  process.stdout.write(`\n▶ ${label}\n`);
  const child = spawn(invocation.file, invocation.args, {
    cwd,
    detached: process.platform !== "win32",
    stdio: "inherit",
    windowsHide: true,
  });
  let timedOut = false;
  let interrupted = false;
  let hardKillTimer;
  let hardKillDone;
  const stop = (isTimeout = false) => {
    timedOut ||= isTimeout;
    interrupted ||= !isTimeout;
    terminateTree(child);
    if (!hardKillDone) {
      hardKillDone = new Promise((resolve) => {
        hardKillTimer = setTimeout(() => {
          terminateTree(child, true);
          resolve();
        }, 500);
      });
    }
  };
  const onAbort = () => stop(false);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    stop(true);
  }, timeoutMs);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once("error", (error) => reject(new Error(`FAST_GATE_SPAWN_FAILED:${typeof error?.code === "string" ? error.code : "UNKNOWN"}`)));
      child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });
    if (hardKillDone) await hardKillDone;
  } finally {
    clearTimeout(timer);
    clearTimeout(hardKillTimer);
    signal?.removeEventListener("abort", onAbort);
  }
  if (timedOut) throw new Error(`FAST_GATE_SLO_EXCEEDED:${label}`);
  if (interrupted) throw new Error(`FAST_GATE_INTERRUPTED:${signal?.reason || "ABORT"}`);
  if (result.signal || result.code !== 0) throw new Error(`FAST_GATE_COMMAND_FAILED:${label}:${result.signal || result.code}`);
}

export async function runFastGate({ root = ROOT, limitMs } = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const onSigint = () => controller.abort("SIGINT");
  const onSigterm = () => controller.abort("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  let initial;
  let commands;
  let budgetMs;
  try {
    initial = readExactStagedSnapshot(root);
    budgetMs = limitMs ?? fastGateLimitFor(initial.paths);
    commands = commandsFor(initial.paths, root);
    for (const command of commands) {
      const remaining = budgetMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new Error("FAST_GATE_SLO_EXCEEDED");
      await runCommand({ ...command, cwd: root, timeoutMs: remaining, signal: controller.signal });
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
  assertStagedSnapshotUnchanged(initial, readExactStagedSnapshot(root));
  const durationMs = Date.now() - startedAt;
  if (durationMs >= budgetMs) throw new Error(`FAST_GATE_SLO_EXCEEDED:${durationMs}`);
  return { tree: initial.tree, changed: initial.paths.length, commands: commands.length, durationMs, limitMs: budgetMs };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runFastGate().then((result) => {
    console.log(`FAST_GATE_GREEN ${JSON.stringify(result)}`);
  }).catch((error) => {
    const message = String(error?.message || error);
    const code = message.split(":")[0];
    console.error(`FAST_GATE_FAILURE ${JSON.stringify({ code })}`);
    process.exitCode = message.includes(":SIGINT") ? 130 : message.includes(":SIGTERM") ? 143 : 1;
  });
}
