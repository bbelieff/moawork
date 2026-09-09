import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renderProvisionAssets } from "./assets.mjs";
import { buildProvisionPlan, createLinuxProvisionExecutor, executeProvisionPlan } from "./installer.mjs";
import { provisionFixture, provisionPrestate, runtimeEnvironmentFixture } from "./test-fixtures.mjs";

const CADDY_ROOT_BYTES = Buffer.from("existing caddy root\n");
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fileStats({ dev, ino, uid = 0, gid = 0, mode = 0o100644, nlink = 1 } = {}) {
  return { dev, ino, uid, gid, mode, nlink, isFile: () => true };
}

function absent() {
  return Object.assign(new Error("absent"), { code: "ENOENT" });
}

function livePrestateFs(manifest, lockIdentity, patch = {}) {
  const rootIdentity = fileStats({ dev: 7, ino: 11 });
  return {
    async lstat(target) {
      if (target === manifest.paths.provisionLockFile) return lockIdentity;
      if (target === manifest.paths.caddyConfigFile) return rootIdentity;
      throw absent();
    },
    async readFile(target) {
      if (target === manifest.paths.caddyConfigFile) return CADDY_ROOT_BYTES;
      throw absent();
    },
    ...patch,
  };
}

function input() {
  const { manifest, auditSummary, trustedBuilderBytes } = provisionFixture();
  return {
    manifest,
    auditSummary,
    prestate: provisionPrestate(manifest),
    runtimeEnvironment: runtimeEnvironmentFixture(),
    nodeArchiveSha256: manifest.node.archiveSha256,
    trustedBuilderBytes,
  };
}

function permits({ ownerUid, groupGid, mode }, actor, bit) {
  const numeric = Number.parseInt(mode, 8);
  const shift = actor.uid === ownerUid ? 6 : actor.gids.includes(groupGid) ? 3 : 0;
  return ((numeric >> shift) & bit) === bit;
}

test("default mode returns a secret-free deterministic dry-run with zero executor calls", async () => {
  const plan = buildProvisionPlan(input());
  assert.equal(JSON.stringify(plan).includes("abcdefghijklmnopqrst.supabase.co"), false);
  assert.deepEqual(plan.steps.find((step) => step.id === "runtime-env").names, runtimeEnvironmentFixture().map(({ name }) => name).sort());
  const calls = [];
  const result = await executeProvisionPlan(plan, { executor: { begin() { calls.push("begin"); } } });
  assert.deepEqual(result, { applied: false, mode: "dry-run", planSha256: plan.planSha256, stepCount: plan.steps.length });
  assert.deepEqual(calls, []);
  const nodeRoot = plan.steps.findIndex((step) => step.id === "node-root");
  const nodeRuntime = plan.steps.findIndex((step) => step.id === "node-runtime");
  assert.ok(nodeRoot >= 0 && nodeRoot < nodeRuntime);
  assert.equal(plan.steps[nodeRoot].target, "/opt/moawork");
  assert.equal(plan.steps.some((step) => step.kind === "reload_unit"), false);
});

test("planned POSIX DAC lets deploy publish Caddy state while service and unrelated actors cannot mutate it", () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  const deploy = { uid: value.manifest.accounts.deploy.uid, gids: [value.manifest.accounts.deploy.gid, ...value.manifest.accounts.deploy.supplementaryGids] };
  const service = { uid: value.manifest.accounts.service.uid, gids: [value.manifest.accounts.service.gid] };
  const unrelated = { uid: 2999, gids: [2999] };
  const root = { uid: 0, gids: [0] };
  const configRoot = { ownerUid: 0, groupGid: value.manifest.accounts.service.gid, mode: byId.get("config-root").mode };
  const managed = { ownerUid: value.manifest.accounts.deploy.uid, groupGid: 0, mode: byId.get("caddy-managed").mode };
  const runtime = { ownerUid: 0, groupGid: 0, mode: byId.get("runtime-env").mode };
  const trustedKey = { ownerUid: 0, groupGid: value.manifest.accounts.service.gid, mode: byId.get("trusted-builder").mode };

  assert.equal(permits(configRoot, deploy, 1), true, "deploy supplementary service group traverses /etc/moawork");
  assert.equal(permits(managed, deploy, 3), true, "deploy can traverse and write the managed Caddy directory");
  assert.equal(permits(managed, service, 2), false, "service cannot write Caddy upstream state");
  assert.equal(permits(managed, unrelated, 2), false, "unrelated actor cannot write Caddy upstream state");
  assert.equal(permits(runtime, deploy, 4), false, "deploy cannot read runtime secrets");
  assert.equal(permits(runtime, service, 4), false, "service relies on systemd root reading EnvironmentFile, not direct secret access");
  assert.equal(permits(runtime, unrelated, 4), false, "unrelated actor cannot read runtime secrets");
  assert.equal(permits(runtime, root, 4), true);
  assert.equal(permits(trustedKey, deploy, 4), true);
  assert.equal(permits(trustedKey, service, 4), true);
  assert.equal(permits(trustedKey, unrelated, 4), false);
});

test("fails before a write for incomplete audit, occupied path, archive drift, and secret credential", () => {
  const base = input();
  const cases = [
    { ...base, auditSummary: { ...base.auditSummary, complete: false } },
    { ...base, prestate: { ...base.prestate, managedPaths: base.prestate.managedPaths.map((entry) => entry.path === base.manifest.paths.releaseRoot ? { ...entry, state: "existing_preserved" } : entry) } },
    { ...base, nodeArchiveSha256: "0".repeat(64) },
    { ...base, trustedBuilderBytes: Buffer.from("not a key") },
    { ...base, runtimeEnvironment: [{ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: "sb_secret_hidden" }] },
  ];
  for (const candidate of cases) assert.throws(() => buildProvisionPlan(candidate));
});

test("empty and no-final-newline Caddy roots remain exact valid observed prestate", () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("example.test { respond 200 }")]) {
    const value = input();
    value.prestate.caddyRoot = {
      ...value.prestate.caddyRoot,
      digest: hash(bytes),
      unmanagedDigest: hash(bytes),
      endsWithNewline: false,
    };
    assert.doesNotThrow(() => buildProvisionPlan(value));
  }
});

test("apply requires exact reviewed plan confirmation", async () => {
  const plan = buildProvisionPlan(input());
  await assert.rejects(() => executeProvisionPlan(plan, { apply: true, confirmPlanSha256: "0".repeat(64) }), (error) => error.code === "CONFIRMATION_REQUIRED");
});

test("rolls back the failing step and all prior steps in reverse order", async () => {
  const plan = buildProvisionPlan(input());
  const applied = [];
  const rolledBack = [];
  let recovered = false;
  const executor = {
    async begin(value) { assert.equal(value.planSha256, plan.planSha256); return { id: "tx" }; },
    async apply(_tx, step) {
      if (step.id === "user-service") throw Object.assign(new Error("injected"), { code: "INJECTED" });
      applied.push(step.id);
    },
    async rollback(_tx, step) { rolledBack.push(step.id); },
    async recover() { recovered = true; },
    async commit() { assert.fail("commit must not run after failure"); },
  };
  await assert.rejects(
    () => executeProvisionPlan(plan, { apply: true, confirmPlanSha256: plan.planSha256, executor }),
    (error) => error.code === "APPLY_ROLLED_BACK",
  );
  assert.deepEqual(applied, ["group-service", "group-deploy"]);
  assert.deepEqual(rolledBack, ["user-service", "group-deploy", "group-service"]);
  assert.equal(recovered, true);
});

test("Linux executor compensates a user or directory step that fails after its first mutation", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const calls = [];
  const removedDirectories = [];
  let failure = "usermod";
  const fs = {
    async rmdir(target) { removedDirectories.push(target); },
    async mkdir() {},
    async chown() { if (failure === "chown") throw Object.assign(new Error("injected chown"), { code: "EPERM" }); },
    async chmod() {},
  };
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest,
    assets: plan.assets,
    runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz",
    trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux",
    getuid: () => 0,
    fs,
    run: async (file, args) => {
      calls.push([file, ...args]);
      if (failure === "usermod" && file === "/usr/sbin/usermod") throw Object.assign(new Error("injected usermod"), { code: "INJECTED" });
      return { stdout: "" };
    },
  });
  const userStep = plan.steps.find((step) => step.id === "user-deploy");
  await assert.rejects(() => executor.apply({}, userStep), /injected usermod/);
  await executor.rollback({}, userStep);
  assert.deepEqual(calls.at(-1), ["/usr/sbin/userdel", "--remove", value.manifest.accounts.deploy.name]);

  failure = "chown";
  const directoryStep = plan.steps.find((step) => step.id === "release-root");
  await assert.rejects(() => executor.apply({}, directoryStep), /injected chown/);
  await executor.rollback({}, directoryStep);
  assert.deepEqual(removedDirectories, [directoryStep.target]);
});

test("Linux executor extracts only a root-private copy whose bytes match the reviewed archive", async () => {
  const value = input();
  const archiveBytes = Buffer.from("reviewed archive bytes");
  value.manifest.node.archiveSha256 = (await import("node:crypto")).createHash("sha256").update(archiveBytes).digest("hex");
  const plan = buildProvisionPlan({ ...value, nodeArchiveSha256: value.manifest.node.archiveSha256 });
  const calls = [];
  const written = [];
  const removed = [];
  const handles = [];
  const fs = {
    async mkdir(target, options) { calls.push(["mkdir", target, options.mode]); },
    async readFile(target) { calls.push(["readFile", target]); return archiveBytes; },
    async open(target, flag, mode) {
      calls.push(["open", target, flag, mode]);
      const handle = { async writeFile(bytes) { written.push(Buffer.from(bytes)); }, async sync() {}, async close() {} };
      handles.push(handle);
      return handle;
    },
    async unlink(target) { removed.push(target); },
    async rename(from, to) { calls.push(["rename", from, to]); },
    async cp(from, to, options) { calls.push(["cp", from, to, options]); },
    async rm(target) { removed.push(target); },
  };
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest,
    assets: plan.assets,
    runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/incoming/node.tar.xz",
    trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux",
    getuid: () => 0,
    fs,
    run: async (file, args) => {
      calls.push([file, ...args]);
      return { stdout: file.endsWith("/bin/node") ? value.manifest.node.version : "" };
    },
  });
  const step = plan.steps.find((candidate) => candidate.id === "node-runtime");
  await executor.apply({}, step);
  const pinned = `${step.target}.archive-${process.pid}/node-runtime.tar.xz`;
  assert.deepEqual(written, [archiveBytes]);
  assert.ok(calls.some((call) => call[0] === "/usr/bin/tar" && call[2] === pinned));
  assert.equal(calls.some((call) => call[0] === "/usr/bin/tar" && call.includes("/incoming/node.tar.xz")), false);
  assert.ok(removed.includes(`${step.target}.archive-${process.pid}`));
});

test("Linux executor rejects changed archive bytes before tar and cleans private staging", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const calls = [];
  const removed = [];
  const fs = {
    async mkdir() {},
    async readFile() { return Buffer.from("changed after plan"); },
    async rm(target) { removed.push(target); },
  };
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest,
    assets: plan.assets,
    runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/incoming/node.tar.xz",
    trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux",
    getuid: () => 0,
    fs,
    run: async (...args) => { calls.push(args); return { stdout: "" }; },
  });
  const step = plan.steps.find((candidate) => candidate.id === "node-runtime");
  await assert.rejects(() => executor.apply({}, step), (error) => error.code === "NODE_ARCHIVE_MISMATCH");
  assert.equal(calls.length, 0);
  assert.deepEqual(removed, [
    `${step.target}.provision-${process.pid}`,
    `${step.target}.archive-${process.pid}`,
  ]);
});

test("Linux executor registers installed Node rollback before private-archive cleanup can fail", async () => {
  const value = input();
  const archiveBytes = Buffer.from("reviewed archive bytes");
  value.manifest.node.archiveSha256 = (await import("node:crypto")).createHash("sha256").update(archiveBytes).digest("hex");
  const plan = buildProvisionPlan({ ...value, nodeArchiveSha256: value.manifest.node.archiveSha256 });
  const removed = [];
  const fs = {
    async mkdir() {},
    async readFile() { return archiveBytes; },
    async open() { return { async writeFile() {}, async sync() {}, async close() {} }; },
    async rename() {},
    async rm(target) {
      removed.push(target);
      if (target.endsWith(`.archive-${process.pid}`)) throw Object.assign(new Error("injected cleanup failure"), { code: "EPERM" });
    },
  };
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest,
    assets: plan.assets,
    runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/incoming/node.tar.xz",
    trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux",
    getuid: () => 0,
    fs,
    run: async (file) => ({ stdout: file.endsWith("/bin/node") ? value.manifest.node.version : "" }),
  });
  const step = plan.steps.find((candidate) => candidate.id === "node-runtime");
  await assert.rejects(() => executor.apply({}, step), /injected cleanup failure/);
  await executor.rollback({}, step);
  assert.ok(removed.includes(step.target));
});

test("Linux executor removes its exact owned lock when lock initialization fails", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const calls = [];
  const lockIdentity = fileStats({ dev: 1, ino: 2, mode: 0o100600 });
  const fs = livePrestateFs(value.manifest, lockIdentity, {
    async open(target, flag, mode) {
      calls.push(["open", target, flag, mode]);
      return {
        async stat() { return lockIdentity; },
        async writeFile() { throw Object.assign(new Error("injected lock write"), { code: "EIO" }); },
        async close() { calls.push(["close"]); },
      };
    },
    async unlink(target) { calls.push(["unlink", target]); },
  });
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest,
    assets: plan.assets,
    runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/incoming/node.tar.xz",
    trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux",
    getuid: () => 0,
    fs,
    run: async () => ({ stdout: "" }),
  });
  await assert.rejects(() => executor.begin(plan), /injected lock write/);
  assert.deepEqual(calls, [
    ["open", value.manifest.paths.provisionLockFile, "wx", 0o600],
    ["close"],
    ["unlink", value.manifest.paths.provisionLockFile],
  ]);
});

test("Linux executor preserves owned lock cleanup state until unlink succeeds", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const calls = [];
  let unlinkAttempts = 0;
  const lockIdentity = fileStats({ dev: 1, ino: 2, mode: 0o100600 });
  const fs = livePrestateFs(value.manifest, lockIdentity, {
    async open() {
      return {
        async stat() { return lockIdentity; },
        async writeFile() {},
        async sync() {},
        async close() { calls.push("close"); },
      };
    },
    async unlink() {
      unlinkAttempts += 1;
      calls.push(`unlink-${unlinkAttempts}`);
      if (unlinkAttempts === 1) throw Object.assign(new Error("injected unlink failure"), { code: "EIO" });
    },
  });
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest,
    assets: plan.assets,
    runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/incoming/node.tar.xz",
    trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux",
    getuid: () => 0,
    fs,
    run: async () => ({ stdout: "" }),
  });
  const transaction = await executor.begin(plan);
  await assert.rejects(() => executor.commit(transaction), (error) => error.code === "EIO");
  assert.equal(transaction.lockHandleOpen, false);
  assert.equal(transaction.lockPathOwned, true);
  assert.notEqual(transaction.lock, null);
  await executor.abort(transaction);
  assert.equal(transaction.lockPathOwned, false);
  assert.equal(transaction.lock, null);
  assert.deepEqual(calls, ["close", "unlink-1", "unlink-2"]);
});

test("Linux executor rechecks audited absence under its owned lock and never overwrites an intervening target", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const lockIdentity = fileStats({ dev: 1, ino: 2, mode: 0o100600 });
  const appeared = plan.steps.find((step) => step.id === "asset-blueUnit").target;
  const unlinked = [];
  const fs = livePrestateFs(value.manifest, lockIdentity, {
    async open() {
      return { async stat() { return lockIdentity; }, async writeFile() {}, async sync() {}, async close() {} };
    },
    async lstat(target) {
      if (target === value.manifest.paths.provisionLockFile) return lockIdentity;
      if (target === value.manifest.paths.caddyConfigFile) return fileStats({ dev: 7, ino: 11 });
      if (target === appeared) return fileStats({ dev: 8, ino: 12 });
      throw absent();
    },
    async unlink(target) { unlinked.push(target); },
  });
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  await assert.rejects(() => executor.begin(plan), (error) => error.code === "PRESTATE_CHANGED");
  assert.deepEqual(unlinked, [value.manifest.paths.provisionLockFile]);
  assert.equal(unlinked.includes(appeared), false);
});

test("Linux executor never unlinks a substituted foreign provision lock", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const owned = fileStats({ dev: 1, ino: 2, mode: 0o100600 });
  const foreign = fileStats({ dev: 1, ino: 3, mode: 0o100600 });
  let substituted = false;
  const unlinked = [];
  const fs = livePrestateFs(value.manifest, owned, {
    async open() {
      return { async stat() { return owned; }, async writeFile() {}, async sync() {}, async close() {} };
    },
    async lstat(target) {
      if (target === value.manifest.paths.provisionLockFile) return substituted ? foreign : owned;
      if (target === value.manifest.paths.caddyConfigFile) return fileStats({ dev: 7, ino: 11 });
      throw absent();
    },
    async unlink(target) { unlinked.push(target); },
  });
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const transaction = await executor.begin(plan);
  substituted = true;
  await assert.rejects(() => executor.commit(transaction), (error) => error.code === "LOCK_OWNERSHIP_LOST");
  assert.deepEqual(unlinked, []);
  assert.equal(transaction.lockPathOwned, true);
});

test("Linux executor publishes managed files with no-clobber link semantics", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const removed = [];
  const fs = {
    async writeFile() {}, async chown() {}, async chmod() {},
    async link() { throw Object.assign(new Error("foreign target appeared"), { code: "EEXIST" }); },
    async unlink(target) { removed.push(target); },
  };
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets: plan.assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const step = plan.steps.find((candidate) => candidate.id === "runtime-env");
  await assert.rejects(() => executor.apply({}, step), (error) => error.code === "EEXIST");
  assert.deepEqual(removed, [`${step.target}.provision-${process.pid}.tmp`]);
  assert.equal(removed.includes(step.target), false);
});

function caddyMemoryFs(target, initialBytes, {
  replacePathBeforeAppend = null,
  sameInodeAppendBeforeManaged = null,
  sameInodeAppendAfterManaged = null,
  partialManagedWriteBytes = null,
  closeError = null,
} = {}) {
  let nextIno = 20;
  let appendAttempted = false;
  let truncateCalls = 0;
  const files = new Map([[target, { bytes: Buffer.from(initialBytes), dev: 1, ino: 11, uid: 0, gid: 0, mode: 0o100644 }]]);
  const directories = new Set();
  const metadata = (entry) => ({
    dev: entry.dev,
    ino: entry.ino,
    uid: entry.uid,
    gid: entry.gid,
    mode: entry.mode,
    nlink: [...files.values()].filter((value) => value === entry).length,
    isFile: () => true,
  });
  const api = {
    files,
    directories,
    get truncateCalls() { return truncateCalls; },
    async open(path, flags) {
      assert.equal(flags, fsConstants.O_RDWR | fsConstants.O_APPEND);
      const entry = files.get(path);
      if (!entry) throw absent();
      let position = 0;
      return {
        async stat() { return metadata(entry); },
        async readFile() {
          const bytes = Buffer.from(entry.bytes.subarray(position));
          position = entry.bytes.length;
          return bytes;
        },
        async writeFile(bytes) {
          assert.equal(appendAttempted, false, "the managed Caddy delta is one bounded append");
          appendAttempted = true;
          if (replacePathBeforeAppend) {
            files.set(path, { bytes: Buffer.from(replacePathBeforeAppend), dev: 1, ino: nextIno++, uid: 0, gid: 0, mode: 0o100644 });
          }
          if (sameInodeAppendBeforeManaged) entry.bytes = Buffer.concat([entry.bytes, Buffer.from(sameInodeAppendBeforeManaged)]);
          const managed = Buffer.from(bytes);
          if (partialManagedWriteBytes !== null) {
            entry.bytes = Buffer.concat([entry.bytes, managed.subarray(0, partialManagedWriteBytes)]);
            throw Object.assign(new Error("injected interrupted append"), { code: "EIO" });
          }
          // O_APPEND writes at the inode's current EOF, not at the descriptor's
          // stale position left by readFile(). This intentionally differs from
          // the old mock that concatenated regardless of the open flags.
          assert.equal((flags & fsConstants.O_APPEND) !== 0, true);
          entry.bytes = Buffer.concat([entry.bytes, managed]);
          position = entry.bytes.length;
          if (sameInodeAppendAfterManaged) entry.bytes = Buffer.concat([entry.bytes, Buffer.from(sameInodeAppendAfterManaged)]);
        },
        async truncate(length) {
          truncateCalls += 1;
          entry.bytes = entry.bytes.subarray(0, length);
        },
        async sync() {},
        async close() {
          if (closeError) throw Object.assign(new Error("injected descriptor close failure"), { code: closeError });
        },
      };
    },
    async lstat(path) {
      const entry = files.get(path);
      if (!entry) throw absent();
      return metadata(entry);
    },
    async stat(path) { return api.lstat(path); },
    async readFile(path) {
      const entry = files.get(path);
      if (!entry) throw absent();
      return Buffer.from(entry.bytes);
    },
    async writeFile(path, bytes, options = {}) {
      if (options.flag === "wx" && files.has(path)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      files.set(path, { bytes: Buffer.from(bytes), dev: 1, ino: nextIno++, uid: 0, gid: 0, mode: 0o100000 | (options.mode ?? 0o600) });
    },
    async mkdir(path) {
      if (directories.has(path)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      directories.add(path);
    },
    async rmdir(path) {
      if (!directories.delete(path)) throw absent();
    },
    async chown(path, uid, gid) {
      const entry = files.get(path);
      if (entry) { entry.uid = uid; entry.gid = gid; }
    },
    async chmod(path, mode) {
      const entry = files.get(path);
      if (entry) entry.mode = 0o100000 | mode;
    },
    async rename(from, to) {
      const entry = files.get(from);
      if (!entry) throw absent();
      files.set(to, entry);
      files.delete(from);
    },
    async link(from, to) {
      if (files.has(to)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      const entry = files.get(from);
      if (!entry) throw absent();
      files.set(to, entry);
    },
    async unlink(path) {
      if (!files.delete(path)) throw absent();
    },
  };
  return api;
}

test("Caddy exact publication preserves a foreign replacement racing after the final digest read", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const step = plan.steps.find((candidate) => candidate.id === "caddy-import");
  const foreign = Buffer.from("foreign concurrent Caddy root\n");
  const fs = caddyMemoryFs(step.target, CADDY_ROOT_BYTES, { replacePathBeforeAppend: foreign });
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const transaction = { caddyRootIdentity: { dev: 1, ino: 11, digest: hash(CADDY_ROOT_BYTES) } };
  await assert.rejects(() => executor.apply(transaction, step), (error) => error.code === "PRESTATE_CHANGED");
  assert.deepEqual(await fs.readFile(step.target), foreign);
  assert.equal(fs.truncateCalls, 0);
  assert.equal([...fs.files.keys()].some((path) => path.includes(".provision-")), false);
});

test("Caddy O_APPEND preserves a same-inode concurrent append and retains exact recovery state", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const step = plan.steps.find((candidate) => candidate.id === "caddy-import");
  const foreign = Buffer.from("# concurrent operator append\n");
  const fs = caddyMemoryFs(step.target, CADDY_ROOT_BYTES, { sameInodeAppendBeforeManaged: foreign });
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const transaction = { caddyRootIdentity: { dev: 1, ino: 11, digest: hash(CADDY_ROOT_BYTES) } };
  await assert.rejects(() => executor.apply(transaction, step), (error) => error.code === "PRESTATE_CHANGED");
  assert.deepEqual(
    await fs.readFile(step.target),
    Buffer.concat([CADDY_ROOT_BYTES, foreign, Buffer.from(assets.caddyImport.bytes)]),
  );
  await assert.rejects(() => executor.rollback(transaction, step), (error) => error.code === "CADDY_RECOVERY_REQUIRED");
  assert.equal(transaction.retainCaddyAssets, true);
  assert.equal(transaction.retainProvisionLock, true);
  assert.equal(fs.truncateCalls, 0);
});

test("Caddy publication uses real O_APPEND EOF semantics after its descriptor read advanced the offset", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moawork-caddy-append-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "Caddyfile");
  const original = Buffer.from("existing real file bytes\n");
  const foreign = Buffer.from("# concurrent same-inode bytes\n");
  await fs.writeFile(target, original, { flag: "wx", mode: 0o644 });
  const before = await fs.stat(target);
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const plannedStep = plan.steps.find((candidate) => candidate.id === "caddy-import");
  const step = { ...plannedStep, target };
  const instrumentedFs = {
    open: async (file, flags) => {
      assert.equal(flags, fsConstants.O_RDWR | fsConstants.O_APPEND);
      const handle = await fs.open(file, flags);
      return {
        stat: () => handle.stat(),
        readFile: () => handle.readFile(),
        async writeFile(bytes) {
          await fs.appendFile(file, foreign);
          await handle.writeFile(bytes);
        },
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    },
    lstat: (file) => fs.lstat(file),
    stat: (file) => fs.stat(file),
    readFile: (file) => fs.readFile(file),
  };
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs: instrumentedFs, run: async () => ({ stdout: "" }),
  });
  const transaction = { caddyRootIdentity: { dev: before.dev, ino: before.ino, digest: hash(original) } };
  await assert.rejects(() => executor.apply(transaction, step), (error) => error.code === "PRESTATE_CHANGED");
  const after = await fs.stat(target);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.deepEqual(await fs.readFile(target), Buffer.concat([original, foreign, Buffer.from(assets.caddyImport.bytes)]));
  await assert.rejects(() => executor.rollback(transaction, step), (error) => error.code === "CADDY_RECOVERY_REQUIRED");
});

test("Caddy interrupted append retains partial bytes and never truncates unknown state", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const step = plan.steps.find((candidate) => candidate.id === "caddy-import");
  const fs = caddyMemoryFs(step.target, CADDY_ROOT_BYTES, { partialManagedWriteBytes: 4 });
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const transaction = { caddyRootIdentity: { dev: 1, ino: 11, digest: hash(CADDY_ROOT_BYTES) } };
  await assert.rejects(() => executor.apply(transaction, step), (error) => error.code === "EIO");
  assert.deepEqual(
    await fs.readFile(step.target),
    Buffer.concat([CADDY_ROOT_BYTES, Buffer.from(assets.caddyImport.bytes).subarray(0, 4)]),
  );
  await assert.rejects(() => executor.rollback(transaction, step), (error) => error.code === "CADDY_RECOVERY_REQUIRED");
  assert.equal(transaction.retainCaddyAssets, true);
  assert.equal(transaction.retainProvisionLock, true);
  assert.equal(fs.truncateCalls, 0);
});

test("Caddy full append plus descriptor-close failure retains its include, directory, and lock", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const directoryStep = plan.steps.find((candidate) => candidate.id === "caddy-managed");
  const siteStep = plan.steps.find((candidate) => candidate.id === "asset-caddySite");
  const importStep = plan.steps.find((candidate) => candidate.id === "caddy-import");
  const fs = caddyMemoryFs(importStep.target, CADDY_ROOT_BYTES, { closeError: "ECLOSE" });
  const linuxExecutor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const transaction = {
    caddyRootIdentity: { dev: 1, ino: 11, digest: hash(CADDY_ROOT_BYTES) },
    lockPathOwned: true,
  };
  const delegated = new Set([directoryStep.id, siteStep.id, importStep.id]);
  const executor = {
    async begin() { return transaction; },
    async apply(activeTransaction, step) {
      if (delegated.has(step.id)) await linuxExecutor.apply(activeTransaction, step);
    },
    async rollback(activeTransaction, step) { await linuxExecutor.rollback(activeTransaction, step); },
    async recover(activeTransaction) { await linuxExecutor.recover(activeTransaction); },
    async abort(activeTransaction) { await linuxExecutor.abort(activeTransaction); },
    async commit() { assert.fail("commit must not run after descriptor close failure"); },
  };
  await assert.rejects(
    () => executeProvisionPlan(plan, { apply: true, confirmPlanSha256: plan.planSha256, executor }),
    (error) => {
      assert.equal(error.code, "ROLLBACK_INCOMPLETE");
      assert.equal(error.cause.code, "ECLOSE");
      assert.ok(error.errors.some((item) => item.cause?.code === "CADDY_RECOVERY_REQUIRED"));
      return true;
    },
  );
  assert.deepEqual(await fs.readFile(importStep.target), Buffer.concat([CADDY_ROOT_BYTES, Buffer.from(assets.caddyImport.bytes)]));
  assert.deepEqual(await fs.readFile(siteStep.target), Buffer.from(assets.caddySite.bytes));
  assert.equal(fs.directories.has(directoryStep.target), true);
  assert.equal(transaction.retainProvisionLock, true);
  assert.equal(transaction.lockPathOwned, true);
  assert.equal(fs.truncateCalls, 0);
});

test("Caddy partial append plus descriptor-close failure preserves both errors and recovery state", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const step = plan.steps.find((candidate) => candidate.id === "caddy-import");
  const fs = caddyMemoryFs(step.target, CADDY_ROOT_BYTES, { partialManagedWriteBytes: 3, closeError: "ECLOSE" });
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const transaction = { caddyRootIdentity: { dev: 1, ino: 11, digest: hash(CADDY_ROOT_BYTES) } };
  await assert.rejects(
    () => executor.apply(transaction, step),
    (error) => error instanceof AggregateError
      && error.code === "EIO"
      && error.caddyAppendMayRemain === true
      && error.errors.some((item) => item.code === "ECLOSE"),
  );
  assert.deepEqual(
    await fs.readFile(step.target),
    Buffer.concat([CADDY_ROOT_BYTES, Buffer.from(assets.caddyImport.bytes).subarray(0, 3)]),
  );
  await assert.rejects(() => executor.rollback(transaction, step), (error) => error.code === "CADDY_RECOVERY_REQUIRED");
  assert.equal(transaction.retainCaddyAssets, true);
  assert.equal(transaction.retainProvisionLock, true);
  assert.equal(fs.truncateCalls, 0);
});

test("Caddy exact publication and rollback retain every no-final-newline byte for manual recovery", async () => {
  const value = input();
  const original = Buffer.from("example.test { respond 200 }");
  value.prestate.caddyRoot = { ...value.prestate.caddyRoot, digest: hash(original), unmanagedDigest: hash(original), endsWithNewline: false };
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const step = plan.steps.find((candidate) => candidate.id === "caddy-import");
  const fs = caddyMemoryFs(step.target, original);
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const transaction = { caddyRootIdentity: { dev: 1, ino: 11, digest: hash(original) } };
  await executor.apply(transaction, step);
  assert.deepEqual(await fs.readFile(step.target), Buffer.concat([original, Buffer.from(assets.caddyImport.bytes)]));
  await assert.rejects(() => executor.rollback(transaction, step), (error) => error.code === "CADDY_RECOVERY_REQUIRED");
  assert.deepEqual(await fs.readFile(step.target), Buffer.concat([original, Buffer.from(assets.caddyImport.bytes)]));
  assert.equal(transaction.retainCaddyAssets, true);
  assert.equal(transaction.retainProvisionLock, true);
  assert.equal(fs.truncateCalls, 0);
  assert.equal([...fs.files.keys()].some((path) => path.includes(".provision-")), false);
});

test("Caddy rollback after a later failure retains the referenced include, managed directory, and lock", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const directoryStep = plan.steps.find((candidate) => candidate.id === "caddy-managed");
  const siteStep = plan.steps.find((candidate) => candidate.id === "asset-caddySite");
  const importStep = plan.steps.find((candidate) => candidate.id === "caddy-import");
  const fs = caddyMemoryFs(importStep.target, CADDY_ROOT_BYTES);
  const linuxExecutor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const transaction = {
    caddyRootIdentity: { dev: 1, ino: 11, digest: hash(CADDY_ROOT_BYTES) },
    lockPathOwned: true,
  };
  const delegated = new Set([directoryStep.id, siteStep.id, importStep.id]);
  const executor = {
    async begin() { return transaction; },
    async apply(activeTransaction, step) {
      if (step.id === "systemd-reload") throw Object.assign(new Error("injected later failure"), { code: "INJECTED" });
      if (delegated.has(step.id)) await linuxExecutor.apply(activeTransaction, step);
    },
    async rollback(activeTransaction, step) { await linuxExecutor.rollback(activeTransaction, step); },
    async recover(activeTransaction) { await linuxExecutor.recover(activeTransaction); },
    async abort(activeTransaction) { await linuxExecutor.abort(activeTransaction); },
    async commit() { assert.fail("commit must not run after the injected later failure"); },
  };
  await assert.rejects(
    () => executeProvisionPlan(plan, { apply: true, confirmPlanSha256: plan.planSha256, executor }),
    (error) => {
      assert.equal(error.code, "ROLLBACK_INCOMPLETE");
      assert.equal(error.cause.code, "INJECTED");
      assert.ok(error.errors.some((item) => item.cause?.code === "CADDY_RECOVERY_REQUIRED"));
      return true;
    },
  );
  assert.deepEqual(await fs.readFile(importStep.target), Buffer.concat([CADDY_ROOT_BYTES, Buffer.from(assets.caddyImport.bytes)]));
  assert.deepEqual(await fs.readFile(siteStep.target), Buffer.from(assets.caddySite.bytes));
  assert.equal(fs.directories.has(directoryStep.target), true);
  assert.equal(transaction.lockPathOwned, true);
  assert.equal(fs.truncateCalls, 0);
});

test("Caddy append followed by a same-inode external append preserves all bytes for recovery", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const assets = renderProvisionAssets(value.manifest);
  const step = plan.steps.find((candidate) => candidate.id === "caddy-import");
  const foreign = Buffer.from("# appended after managed delta\n");
  const fs = caddyMemoryFs(step.target, CADDY_ROOT_BYTES, { sameInodeAppendAfterManaged: foreign });
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest, assets, runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz", trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux", getuid: () => 0, fs, run: async () => ({ stdout: "" }),
  });
  const transaction = { caddyRootIdentity: { dev: 1, ino: 11, digest: hash(CADDY_ROOT_BYTES) } };
  await assert.rejects(() => executor.apply(transaction, step), (error) => error.code === "PRESTATE_CHANGED");
  assert.deepEqual(
    await fs.readFile(step.target),
    Buffer.concat([CADDY_ROOT_BYTES, Buffer.from(assets.caddyImport.bytes), foreign]),
  );
  await assert.rejects(() => executor.rollback(transaction, step), (error) => error.code === "CADDY_RECOVERY_REQUIRED");
  assert.equal(fs.truncateCalls, 0);
});

test("cleanup failures preserve the primary provision failure in one aggregate", async () => {
  const plan = buildProvisionPlan(input());
  const primary = Object.assign(new Error("primary apply failure"), { code: "PRIMARY" });
  const abortFailure = Object.assign(new Error("abort cleanup failure"), { code: "ABORT_FAIL" });
  const executor = {
    async begin() { return {}; },
    async apply() { throw primary; },
    async rollback() {},
    async recover() {},
    async abort() { throw abortFailure; },
    async commit() { assert.fail("commit must not run"); },
  };
  await assert.rejects(
    () => executeProvisionPlan(plan, { apply: true, confirmPlanSha256: plan.planSha256, executor }),
    (error) => {
      assert.equal(error.code, "ROLLBACK_INCOMPLETE");
      assert.equal(error.cause, primary);
      assert.equal(error.errors[0], primary);
      assert.equal(error.errors[1].cause, abortFailure);
      assert.equal(error.errors[1].code, "ABORT_FAIL");
      assert.equal(error.errors[1].provisionStepId, "abort");
      return true;
    },
  );
});

test("Linux executor removes a failed atomic-write temporary without touching the target", async () => {
  const value = input();
  const plan = buildProvisionPlan(value);
  const removed = [];
  const renamed = [];
  const fs = {
    async open() { return { async writeFile() {}, async sync() {}, async close() {} }; },
    async writeFile() {},
    async chown() { throw Object.assign(new Error("injected chown failure"), { code: "EPERM" }); },
    async chmod() {},
    async rename(from, to) { renamed.push([from, to]); },
    async unlink(target) { removed.push(target); },
  };
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest,
    assets: plan.assets,
    runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz",
    trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux",
    getuid: () => 0,
    fs,
    run: async () => ({ stdout: "" }),
  });
  await assert.rejects(
    () => executor.apply({}, plan.steps.find((step) => step.id === "runtime-env")),
    (error) => error.code === "EPERM",
  );
  assert.deepEqual(renamed, []);
  assert.deepEqual(removed, [`${value.manifest.paths.runtimeEnvFile}.provision-${process.pid}.tmp`]);
});

test("Linux executor recovery refreshes only systemd metadata and never reloads an existing service", async () => {
  const value = input();
  const assets = (await import("./assets.mjs")).renderProvisionAssets(value.manifest);
  const calls = [];
  const executor = createLinuxProvisionExecutor({
    manifest: value.manifest,
    assets,
    runtimeEnvironment: value.runtimeEnvironment,
    nodeArchivePath: "/tmp/node.tar.xz",
    trustedBuilderBytes: value.trustedBuilderBytes,
    platform: "linux",
    getuid: () => 0,
    fs: {},
    run: async (file, args) => {
      calls.push([file, ...args]);
      return { stdout: "" };
    },
  });
  const transaction = { systemdReloaded: false };
  await executor.apply(transaction, { kind: "systemctl_daemon_reload", target: value.manifest.executables.systemctlPath });
  await executor.recover(transaction);
  assert.deepEqual(calls, [
    [value.manifest.executables.systemctlPath, "daemon-reload"],
    [value.manifest.executables.systemctlPath, "daemon-reload"],
  ]);
  assert.equal(calls.some((call) => call.includes("reload") || call.includes("restart") || call.includes("stop")), false);
});

test("commits every exact step once after a clean transaction", async () => {
  const plan = buildProvisionPlan(input());
  let committed = false;
  const seen = [];
  const executor = {
    async begin() { return {}; },
    async apply(_tx, step) { seen.push(step.id); },
    async rollback() { assert.fail("rollback must not run"); },
    async commit(_tx, value) { committed = value.planSha256 === plan.planSha256; },
  };
  const result = await executeProvisionPlan(plan, { apply: true, confirmPlanSha256: plan.planSha256, executor });
  assert.equal(result.applied, true);
  assert.equal(committed, true);
  assert.deepEqual(seen, plan.steps.map((step) => step.id));
});
