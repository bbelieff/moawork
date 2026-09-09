import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertStagedSnapshotUnchanged,
  assertKnownIgnoredInputSafe,
  buildFastGatePlan,
  commandsFor,
  isKnownIgnoredOutput,
  parseGitNameStatusZ,
  readExactStagedSnapshot,
  runCommand,
  validateRepoPath,
} from "./fast-staged.mjs";

const source = await readFile(new URL("./fast-staged.mjs", import.meta.url), "utf8");
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

const localGitEnvironmentNames = execFileSync("git", ["rev-parse", "--local-env-vars"], {
  cwd: process.cwd(),
  encoding: "utf8",
}).split(/\r?\n/u).filter(Boolean);

function isolatedGitEnvironment() {
  const env = { ...process.env };
  for (const name of localGitEnvironmentNames) delete env[name];
  return env;
}

function withoutLocalGitEnvironment(callback) {
  const previous = new Map(localGitEnvironmentNames.map((name) => [name, process.env[name]]));
  try {
    for (const name of localGitEnvironmentNames) delete process.env[name];
    return callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("deletions and both rename paths remain in the staged plan", () => {
  const paths = parseGitNameStatusZ([
    "D", "app/src/components/Deleted.tsx",
    "R100", "scripts/ci/old.mjs", "docs/archive/old.txt",
    "",
  ].join("\0"));
  assert.deepEqual(paths, ["app/src/components/Deleted.tsx", "docs/archive/old.txt", "scripts/ci/old.mjs"]);
  const plan = buildFastGatePlan(paths);
  assert.equal(plan.app, true);
  assert.equal(plan.gate, true);
});

test("option-like, traversal, backslash, and control-character paths fail closed", () => {
  for (const value of ["app/-config.ts", "app/src/-danger.test.ts", "../outside.ts", "app//a.ts", "app\\a.ts", "app/a\n.ts"]) {
    assert.throws(() => validateRepoPath(value), /FAST_GATE_PATH_UNSAFE/u);
  }
});

test("declared runtime dotenv and generated outputs are allowed without admitting hidden source or config", () => {
  for (const value of [".env.local", "app/.env.development.local", "worker/.env", "node_modules/pkg/index.js", "app/.next/server.js", "app/next-env.d.ts"]) {
    assert.equal(isKnownIgnoredOutput(value), true, value);
  }
  for (const value of ["app/.env.preview", "app/src/.env.local", "app/ignored-source.ts", "worker/hidden-config.json", "next-env.d.ts", "app/next-env.ts", "app/src/next-env.d.ts"]) {
    assert.equal(isKnownIgnoredOutput(value), false, value);
  }
});

test("the generated Next declaration is canonical, regular, and confined to the worktree", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "moawork-fast-next-env-"));
  const root = path.join(parent, "root");
  const external = path.join(parent, "external");
  try {
    await mkdir(path.join(root, "app"), { recursive: true });
    await writeFile(path.join(root, "app", "next-env.d.ts"), canonicalNextEnv);
    assert.equal(assertKnownIgnoredInputSafe(root, "app/next-env.d.ts"), true);
    await writeFile(path.join(root, "app", "next-env.d.ts"), canonicalNextDevEnv.replaceAll("\n", "\r\n"));
    assert.equal(assertKnownIgnoredInputSafe(root, "app/next-env.d.ts"), true);
    await writeFile(path.join(root, "app", "next-env.d.ts"), "declare const hidden: unique symbol;\n");
    assert.throws(() => assertKnownIgnoredInputSafe(root, "app/next-env.d.ts"), /FAST_GATE_IGNORED_INPUT/u);

    await rm(path.join(root, "app"), { recursive: true, force: true });
    await mkdir(external, { recursive: true });
    await writeFile(path.join(external, "next-env.d.ts"), canonicalNextEnv);
    await symlink(external, path.join(root, "app"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => assertKnownIgnoredInputSafe(root, "app/next-env.d.ts"), /FAST_GATE_IGNORED_INPUT/u);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the plan is narrow but keeps app, worker, migration, and gate boundaries explicit", () => {
  assert.deepEqual(buildFastGatePlan(["docs/record.md"]), {
    paths: ["docs/record.md"], app: false, worker: false, migration: false, gate: false, gateLease: false, visualGate: false,
  });
  const plan = buildFastGatePlan(["package-lock.json", "supabase/migrations/999_example.sql", "scripts/gate-lease.mjs"]);
  assert.equal(plan.app, true);
  assert.equal(plan.worker, true);
  assert.equal(plan.migration, true);
  assert.equal(plan.gate, true);
  assert.equal(plan.gateLease, true);

  const visual = commandsFor(["docs/design/qa-visual-gate-completion.mjs"], process.cwd());
  assert.deepEqual(visual.filter((command) => command.label === "visual completion contract"), [{
    file: process.execPath,
    args: ["--test", "docs/design/qa-visual-gate-completion.test.mjs"],
    label: "visual completion contract",
  }]);
  assert.equal(commandsFor(["docs/design/other.test.mjs"], process.cwd())
    .some((command) => command.label === "visual completion contract"), false);
});

test("changed app tests and lint paths use argv boundaries while deleted files are skipped", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "moawork-fast-plan-"));
  try {
    await writeFile(path.join(root, "package.json"), "{}\n");
    const appDir = path.join(root, "app", "src", "lib");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(appDir, { recursive: true }));
    await writeFile(path.join(appDir, "value.ts"), "export const value = 1;\n");
    await writeFile(path.join(appDir, "value.test.ts"), "\n");
    const commands = commandsFor(["app/src/lib/value.ts", "app/src/lib/deleted.test.ts"], root);
    const lint = commands.find((command) => command.label === "changed app lint");
    const tests = commands.find((command) => command.label === "adjacent app tests");
    assert.deepEqual(lint.args.slice(-2), ["--", "./src/lib/value.ts"]);
    assert.ok(tests.args.includes("./src/lib/value.test.ts"));
    assert.equal(tests.args.includes("./src/lib/deleted.test.ts"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the exact staged snapshot rejects unstaged and untracked source and detects index drift", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "moawork-fast-staged-"));
  const gitEnvironment = isolatedGitEnvironment();
  const runGit = (...args) => execFileSync("git", args, { cwd: root, env: gitEnvironment, stdio: "ignore" });
  const readSnapshot = () => withoutLocalGitEnvironment(() => readExactStagedSnapshot(root));
  try {
    runGit("init");
    await writeFile(path.join(root, ".gitignore"), ".env*\napp/next-env.d.ts\napp/next-env.ts\napp/src/next-env.d.ts\napp/ignored-source.ts\n");
    await writeFile(path.join(root, "tracked.mjs"), "export const value = 1;\n");
    runGit("add", ".gitignore", "tracked.mjs");
    runGit("-c", "user.name=Gate Test", "-c", "user.email=gate@example.invalid", "commit", "-m", "base");
    await writeFile(path.join(root, "tracked.mjs"), "export const value = 2;\n");
    runGit("add", "tracked.mjs");
    const initial = readSnapshot();

    await writeFile(path.join(root, ".env.local"), "FAST_GATE_TEST=placeholder\n");
    assert.deepEqual(readSnapshot(), initial);
    await rm(path.join(root, ".env.local"));

    await mkdir(path.join(root, "app"));
    await writeFile(path.join(root, "app", "next-env.d.ts"), canonicalNextEnv);
    assert.deepEqual(readSnapshot(), initial);
    await writeFile(path.join(root, "app", "next-env.d.ts"), canonicalNextDevEnv);
    assert.deepEqual(readSnapshot(), initial);
    await writeFile(path.join(root, "app", "next-env.ts"), "export const hidden = true;\n");
    assert.throws(readSnapshot, /IGNORED_INPUT/u);
    await rm(path.join(root, "app", "next-env.ts"));
    await mkdir(path.join(root, "app", "src"));
    await writeFile(path.join(root, "app", "src", "next-env.d.ts"), "export {};\n");
    assert.throws(readSnapshot, /IGNORED_INPUT/u);
    await rm(path.join(root, "app"), { recursive: true });

    await writeFile(path.join(root, "tracked.mjs"), "export const value = 3;\n");
    assert.throws(readSnapshot, /UNSTAGED_TRACKED_INPUT/u);
    await writeFile(path.join(root, "tracked.mjs"), "export const value = 2;\n");
    await writeFile(path.join(root, "untracked.txt"), "unexpected\n");
    assert.throws(readSnapshot, /UNTRACKED_INPUT/u);
    await rm(path.join(root, "untracked.txt"));

    await mkdir(path.join(root, "app"));
    await writeFile(path.join(root, "app", "ignored-source.ts"), "export const hidden = true;\n");
    assert.throws(readSnapshot, /IGNORED_INPUT/u);
    await rm(path.join(root, "app"), { recursive: true });

    await writeFile(path.join(root, "tracked.mjs"), "export const value = 4;\n");
    runGit("add", "tracked.mjs");
    assert.throws(() => assertStagedSnapshotUnchanged(initial, readSnapshot()), /STAGED_TREE_DRIFT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("nonzero and timeout subprocesses fail closed with stable codes", async () => {
  await assert.rejects(runCommand({
    file: process.execPath,
    args: ["-e", "process.exit(37)"],
    label: "nonzero fixture",
    cwd: process.cwd(),
    timeoutMs: 5_000,
  }), /FAST_GATE_COMMAND_FAILED:nonzero fixture:37/u);
  await assert.rejects(runCommand({
    file: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    label: "timeout fixture",
    cwd: process.cwd(),
    timeoutMs: 50,
  }), /FAST_GATE_SLO_EXCEEDED:timeout fixture/u);
  assert.match(source, /stdio: "inherit"/u);
  assert.doesNotMatch(source, /shell:\s*true/u);
});

test("an abort terminates the owned child and reports interruption", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("SIGTERM"), 50);
  await assert.rejects(runCommand({
    file: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    label: "abort fixture",
    cwd: process.cwd(),
    timeoutMs: 5_000,
    signal: controller.signal,
  }), /FAST_GATE_INTERRUPTED:SIGTERM/u);
  clearTimeout(timer);
});

test("POSIX timeout and abort hard-kill descendants after the leader exits", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "moawork-fast-descendant-"));
  const descendantSource = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
  const leaderSource = [
    "const {spawn}=require('node:child_process')",
    "const {writeFileSync}=require('node:fs')",
    `const child=spawn(process.execPath,['-e',${JSON.stringify(descendantSource)}],{stdio:'ignore'})`,
    "writeFileSync(process.argv[1],String(child.pid))",
    "process.on('SIGTERM',()=>process.exit(0))",
    "setInterval(()=>{},1000)",
  ].join(";");
  const waitForGone = async (pid) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { process.kill(pid, 0); } catch { return; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(`descendant ${pid} remained alive`);
  };
  try {
    for (const mode of ["timeout", "abort"]) {
      const pidFile = path.join(root, `${mode}.pid`);
      const controller = new AbortController();
      const abortTimer = mode === "abort" ? setTimeout(() => controller.abort("SIGTERM"), 100) : undefined;
      await assert.rejects(runCommand({
        file: process.execPath,
        args: ["-e", leaderSource, pidFile],
        label: `${mode} descendant fixture`,
        cwd: root,
        timeoutMs: mode === "timeout" ? 100 : 5_000,
        signal: controller.signal,
      }), mode === "timeout" ? /FAST_GATE_SLO_EXCEEDED/u : /FAST_GATE_INTERRUPTED/u);
      clearTimeout(abortTimer);
      const pid = Number(await readFile(pidFile, "utf8"));
      await waitForGone(pid);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
