import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chown,
  chmod,
  copyFile,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packReleaseArtifact, verifyReleaseArtifact } from "../artifact/contract.mjs";
import { releaseProvenanceStatement } from "../artifact/provenance.mjs";
import { createLinuxReleaseRuntime, defaultCommandRunner, LinuxReleaseRuntimeError } from "./linux-release-runtime.mjs";
import { createProductionReleaseSlots } from "./production-release.mjs";
import { createReleaseSlots } from "./release-slots.mjs";
import { runReleaseCli } from "./release-cli.mjs";

let artifactTemplate;
let builderKeys;
let SOURCECORE_SELF_HOSTED_READY;
const SOURCECORE_FIXTURE_PATH = fileURLToPath(new URL(
  "../../../app/src/lib/operations/runtime-identity.ready.fixture.json",
  import.meta.url,
));
const SOURCECORE_FIXTURE_SHA256 = "6a1b4e261327a492c3f61cadac1624e54d11bedd8b177371596694ca11faa675";
const FIXTURE_SERVER_ACTIONS_KEY = Buffer.alloc(32, 0x5a).toString("base64");
const FIXTURE_SERVER_ACTIONS_FINGERPRINT = createHmac("sha256", Buffer.from(FIXTURE_SERVER_ACTIONS_KEY, "base64"))
  .update("moawork:server-actions:fingerprint:v1")
  .digest("hex");

test.before(async () => {
  const sourcecoreFixture = await readFile(SOURCECORE_FIXTURE_PATH);
  assert.equal(digest(sourcecoreFixture), SOURCECORE_FIXTURE_SHA256);
  SOURCECORE_SELF_HOSTED_READY = Object.freeze(JSON.parse(sourcecoreFixture).selfHosted);
  const root = await mkdtemp(path.join(os.tmpdir(), "moawork-linux-release-template-"));
  builderKeys = generateKeyPairSync("ed25519");
  const trustedBuilderPublicKeyPath = path.join(root, "builder.pub.pem");
  await writeFile(trustedBuilderPublicKeyPath, builderKeys.publicKey.export({ type: "spki", format: "pem" }));
  artifactTemplate = { root, trustedBuilderPublicKeyPath, ...(await makeArtifactRepository(root)) };
});

test.after(async () => {
  if (artifactTemplate) await rm(artifactTemplate.root, { recursive: true, force: true });
});

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function removeFixtureRoot(root) {
  async function makeWritable(target) {
    const entry = await lstat(target).catch(() => null);
    if (entry === null || entry.isSymbolicLink()) return;
    if (entry.isDirectory()) {
      await chmod(target, 0o700);
      for (const name of await readdir(target)) await makeWritable(path.join(target, name));
    } else {
      await chmod(target, 0o600);
    }
  }
  await makeWritable(root);
  await rm(root, { recursive: true, force: true });
}

async function makeArtifactRepository(root) {
  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, "build", "standalone", "app"), { recursive: true });
  await mkdir(path.join(repo, "build", "static"), { recursive: true });
  await mkdir(path.join(repo, "public"), { recursive: true });
  await writeFile(path.join(repo, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(path.join(repo, "tracked.txt"), "old\n");
  await writeFile(path.join(repo, "build", "standalone", "app", "server.js"), 'console.log("old")\n');
  await writeFile(path.join(repo, "build", "static", "app.js"), "self.old=true\n");
  await writeFile(path.join(repo, "public", "icon.svg"), "<svg/>\n");
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "release@example.invalid"]);
  git(repo, ["config", "user.name", "Release Fixture"]);
  git(repo, ["add", "package-lock.json", "tracked.txt"]);
  git(repo, ["commit", "-m", "old"]);

  async function pack(name) {
    await mkdir(path.join(repo, "build", "standalone", "app", ".next", "server"), { recursive: true });
    await writeFile(
      path.join(repo, "build", "standalone", "app", ".next", "required-server-files.json"),
      `${JSON.stringify({
        config: {
          deploymentId: git(repo, ["rev-parse", "HEAD"]),
          env: { MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: FIXTURE_SERVER_ACTIONS_FINGERPRINT },
        },
      })}\n`,
    );
    await writeFile(
      path.join(repo, "build", "standalone", "app", ".next", "server", "server-reference-manifest.json"),
      `${JSON.stringify({ encryptionKey: FIXTURE_SERVER_ACTIONS_KEY })}\n`,
    );
    const archivePath = path.join(root, `${name}.tar`);
    const manifestPath = path.join(root, `${name}.manifest.json`);
    await packReleaseArtifact({
      repoPath: repo,
      standalonePath: path.join(repo, "build", "standalone"),
      staticPath: path.join(repo, "build", "static"),
      publicPath: path.join(repo, "public"),
      archivePath,
      manifestPath,
    });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.builder.platform = "linux";
    manifest.builder.arch = "x64";
    manifest.builder.nodeVersion = "v22.23.2";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const descriptor = await verifyReleaseArtifact({ archivePath, manifestPath });
    const statement = releaseProvenanceStatement(descriptor, {
      kind: "next-standalone-http-health-v1",
      platform: "linux",
      arch: descriptor.builder.arch,
      nodeVersion: descriptor.builder.nodeVersion,
      healthPath: "/api/health/live",
      sourceSha: descriptor.sourceSha,
      archiveSha256: descriptor.archiveSha256,
      serverActionsKeyFingerprint: descriptor.serverActionsKeyFingerprint,
    }, {
      eventName: "workflow_dispatch",
      job: "release-artifact",
      ref: "refs/heads/main",
      repository: "bbelieff/moawork",
      runAttempt: "1",
      runId: "123456789",
      runnerArch: descriptor.builder.arch.toUpperCase(),
      runnerOs: "Linux",
      sha: descriptor.sourceSha,
      workflowRef: "bbelieff/moawork/.github/workflows/vps-release-artifact.yml@refs/heads/main",
    });
    const statementBytes = Buffer.from(`${JSON.stringify(statement, null, 2)}\n`);
    const keyId = digest(builderKeys.publicKey.export({ type: "spki", format: "der" }));
    const attestationPath = path.join(root, `${name}.attestation.json`);
    await writeFile(attestationPath, `${JSON.stringify({
      schema: 1,
      statement,
      signature: {
        algorithm: "ed25519",
        keyId,
        value: sign(null, statementBytes, builderKeys.privateKey).toString("base64"),
      },
    }, null, 2)}\n`);
    return {
      artifact: {
        ...descriptor,
        assurance: {
          transportIntegrityOnly: false,
          signed: true,
          builderTrustVerified: true,
          linuxAbiVerified: true,
        },
      },
      attestationPath,
    };
  }

  const old = await pack("old");
  await writeFile(path.join(repo, "tracked.txt"), "next\n");
  await writeFile(path.join(repo, "build", "standalone", "app", "server.js"), 'console.log("next")\n');
  git(repo, ["add", "tracked.txt"]);
  git(repo, ["commit", "-m", "next"]);
  const next = await pack("next");
  return {
    oldArtifact: old.artifact,
    oldAttestationPath: old.attestationPath,
    nextArtifact: next.artifact,
    nextAttestationPath: next.attestationPath,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "moawork-linux-release-"));
  if (process.platform === "linux") await chmod(root, 0o755);
  const releaseRoot = path.join(root, "moawork-releases");
  const stateRoot = path.join(root, "moawork-state");
  const caddyRoot = path.join(root, "moawork-caddy");
  const binRoot = path.join(root, "moawork-bin");
  await Promise.all([releaseRoot, stateRoot, caddyRoot, binRoot].map((value) => mkdir(value)));
  if (process.platform === "linux") await chmod(releaseRoot, 0o750);
  const runtimeEnvFile = path.join(root, "moawork-runtime.env");
  const trustedBuilderPublicKeyPath = path.join(root, "builder.pub.pem");
  await copyFile(artifactTemplate.trustedBuilderPublicKeyPath, trustedBuilderPublicKeyPath);
  const caddyConfigFile = path.join(caddyRoot, "Caddyfile");
  const caddySiteFile = path.join(caddyRoot, "moawork.caddy");
  const caddyManagedDirectory = path.join(caddyRoot, "moawork.d");
  await mkdir(caddyManagedDirectory);
  const systemctlPath = path.join(binRoot, "systemctl");
  const caddyPath = path.join(binRoot, "caddy");
  const nodePath = path.join(binRoot, process.platform === "win32" ? "node.exe" : "node");
  await writeFile(runtimeEnvFile, "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=redacted-fixture\n", { mode: 0o600 });
  const upstreamFile = path.join(caddyManagedDirectory, "active.caddy");
  const caddyImportLine = `import ${caddySiteFile}`;
  const caddySite = `example.test {\n\timport ${caddyManagedDirectory}${path.sep}*.caddy\n}\n`;
  await writeFile(caddyConfigFile, `${caddyImportLine}\n`);
  await writeFile(caddySiteFile, caddySite);
  await writeFile(systemctlPath, "fixture\n", { mode: 0o700 });
  await writeFile(caddyPath, "fixture\n", { mode: 0o700 });
  await writeFile(nodePath, "fixture\n", { mode: 0o755 });
  await chmod(runtimeEnvFile, 0o600);
  const config = {
    schema: 1,
    timeoutMs: 10_000,
    trustedBuilderPublicKeyPath,
    slotIds: ["blue", "green"],
    slots: {
      blue: { port: 31_101, releaseDir: path.join(releaseRoot, "blue"), unit: "moawork-web-blue.service" },
      green: { port: 31_102, releaseDir: path.join(releaseRoot, "green"), unit: "moawork-web-green.service" },
    },
    releaseRoot,
    stateFile: path.join(stateRoot, "release-state.json"),
    lockFile: path.join(stateRoot, "release.lock"),
    runtimeEnvFile,
    upstreamFile,
    caddyConfigFile,
    caddyImportLine,
    caddySiteFile,
    caddySiteSha256: digest(Buffer.from(caddySite)),
    caddyClosureSha256: digest(Buffer.from(`${caddyImportLine}\0${caddySite}`)),
    caddyPath,
    nodePath,
    nodeArch: "x64",
    nodeVersion: "v22.23.2",
    caddyUnit: "caddy.service",
    serviceUser: "moawork",
    systemctlPath,
    publicHealthUrl: "https://www.moa-work.com/api/health/ready",
  };
  const artifacts = {};
  const attestations = {};
  for (const [name, template] of [["oldArtifact", artifactTemplate.oldArtifact], ["nextArtifact", artifactTemplate.nextArtifact]]) {
    const stem = name === "oldArtifact" ? "old" : "next";
    const archivePath = path.join(root, `${stem}.tar`);
    const manifestPath = path.join(root, `${stem}.manifest.json`);
    const attestationPath = path.join(root, `${stem}.attestation.json`);
    await copyFile(template.archivePath, archivePath);
    await copyFile(template.manifestPath, manifestPath);
    await copyFile(artifactTemplate[name === "oldArtifact" ? "oldAttestationPath" : "nextAttestationPath"], attestationPath);
    artifacts[name] = { ...template, archivePath, manifestPath };
    attestations[name === "oldArtifact" ? "oldAttestationPath" : "nextAttestationPath"] = attestationPath;
  }
  const commands = [];
  const resolveServiceIdentity = async () => ({
    uid: process.platform === "linux" ? BigInt(process.getuid()) + 1n : 1n,
    gid: process.platform === "linux" ? BigInt(process.getgid()) : 1n,
    groups: [process.platform === "linux" ? BigInt(process.getgid()) : 1n],
  });
  const faults = new Set();
  const unhealthyPorts = new Set();
  const artifactFlagOnlyPorts = new Set();
  const wrongArtifactPorts = new Set();
  const serviceStates = new Map(Object.values(config.slots).map((slot) => [slot.unit, false]));
  let publicPort = null;
  let publicVercelSourceSha = null;
  const commandRunner = async ({ file, args }) => {
    const call = `${path.basename(file)} ${args.join(" ")}`;
    commands.push(call);
    if (faults.has(call)) {
      faults.delete(call);
      throw new Error(`fault: ${call}`);
    }
    if (path.basename(file) === "systemctl" && args[0] === "show") {
      if (args[3] === "--property=ActiveState" && args[4] === "--value") {
        return { stdout: `${serviceStates.get(args[1]) ? "active" : "inactive"}\n`, stderr: "" };
      }
      const slot = Object.keys(config.slots).find((key) => config.slots[key].unit === args[1]);
      const slotConfig = config.slots[slot];
      return {
        stdout: [
          "LoadState=loaded",
          `User=${config.serviceUser}`,
          "Group=",
          `WorkingDirectory=${path.join(slotConfig.releaseDir, "runtime", "app")}`,
          `EnvironmentFiles=${config.runtimeEnvFile} (ignore_errors=no) ${path.join(slotConfig.releaseDir, ".moawork-release.env")} (ignore_errors=no)`,
          `ExecStart={ path=${config.nodePath} ; argv[]=${config.nodePath} server.js ; }`,
          "Restart=on-failure",
          "RestartUSec=5s",
          "MemoryMax=536870912",
          "TasksMax=128",
          "CPUQuotaPerSecUSec=500ms",
          "StandardOutput=journal",
          "StandardError=journal",
          `SyslogIdentifier=${config.slots[slot].unit.replace(/[.]service$/u, "")}`,
          "NoNewPrivileges=yes",
          "PrivateTmp=yes",
          "ProtectSystem=strict",
          "ProtectHome=yes",
          `ReadWritePaths=${config.releaseRoot}`,
          "",
        ].join("\n"),
        stderr: "",
      };
    }
    if (path.basename(file) === "systemctl" && args[0] === "stop") serviceStates.set(args[1], false);
    if (path.basename(file) === "systemctl" && args[0] === "restart") serviceStates.set(args[1], true);
    if (call === "systemctl reload caddy.service") {
      const route = await readFile(config.upstreamFile, "utf8").catch(() => null);
      publicPort = route === null ? null : Number.parseInt(route.match(/:([0-9]+)$/mu)?.[1] ?? "", 10);
    }
    return { stdout: "", stderr: "" };
  };
  const artifactAtPort = async (port) => {
    const slot = Object.keys(config.slots).find((key) => config.slots[key].port === port);
    if (!slot) return null;
    try {
      return JSON.parse(await readFile(path.join(config.slots[slot].releaseDir, ".moawork-artifact.json"), "utf8"));
    } catch {
      return null;
    }
  };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const isDirectVercel = parsed.hostname.endsWith(".vercel.app");
    if (isDirectVercel || (parsed.protocol === "https:" && publicVercelSourceSha !== null)) {
      const sourceSha = publicVercelSourceSha;
      const payload = sourceSha === null
        ? { status: "not_ready" }
        : {
            ...SOURCECORE_SELF_HOSTED_READY,
            runtime: "vercel",
            artifact: "managed",
            artifactSha256: "managed",
            buildSha: sourceSha,
            releaseSha: sourceSha,
            serverActionsKeyFingerprint: FIXTURE_SERVER_ACTIONS_FINGERPRINT,
          };
      return new Response(JSON.stringify(payload), {
        status: sourceSha === null ? 503 : 200,
        headers: { "content-type": "application/json" },
      });
    }
    const port = parsed.protocol === "http:" ? Number(parsed.port) : publicPort;
    const artifact = await artifactAtPort(port);
    const healthy = artifact !== null && !unhealthyPorts.has(port);
    const payload = healthy
      ? {
          ...SOURCECORE_SELF_HOSTED_READY,
          buildSha: artifact.sourceSha,
          releaseSha: artifact.sourceSha,
          serverActionsKeyFingerprint: artifact.serverActionsKeyFingerprint,
        }
      : { status: "not_ready" };
    if (healthy && !artifactFlagOnlyPorts.has(port)) {
      payload.artifactSha256 = wrongArtifactPorts.has(port) ? "f".repeat(64) : artifact.releaseId;
    }
    return new Response(JSON.stringify(payload), { status: healthy ? 200 : 503, headers: { "content-type": "application/json" } });
  };
  const runtime = await createLinuxReleaseRuntime(config, { commandRunner, fetchImpl, resolveServiceIdentity });
  const controller = await createProductionReleaseSlots({ runtime, slotIds: config.slotIds, timeoutMs: config.timeoutMs, trustedBuilderPublicKeyPath: config.trustedBuilderPublicKeyPath });

  async function seedActive(artifact, slot = "blue") {
    await runtime.withExclusiveLock(async () => {
      await runtime.prepare({ slot, artifact, signal: new AbortController().signal });
      await runtime.startCandidate({ slot, artifact, signal: new AbortController().signal });
    });
    const state = JSON.parse(await readFile(config.stateFile, "utf8"));
    state.activeSlot = slot;
    state.previousSlot = null;
    state.slots[slot].state = "active";
    await writeFile(config.stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await writeFile(config.upstreamFile, `reverse_proxy 127.0.0.1:${config.slots[slot].port}\n`);
    publicPort = config.slots[slot].port;
    commands.length = 0;
  }

  return {
    ...artifacts,
    ...attestations,
    artifactFlagOnlyPorts,
    cleanup: () => removeFixtureRoot(root),
    commandRunner,
    commands,
    config,
    controller,
    faults,
    fetchImpl,
    runtime,
    resolveServiceIdentity,
    serviceStates,
    seedActive,
    setPublicPort: (value) => {
      publicPort = value;
      publicVercelSourceSha = null;
    },
    setPublicVercel: (sourceSha) => { publicVercelSourceSha = sourceSha; },
    unhealthyPorts,
    wrongArtifactPorts,
  };
}

test("default command runner settles only after actual child close and reap", async (t) => {
  await t.test("successful child", async () => {
    const result = await defaultCommandRunner({
      file: process.execPath,
      args: ["-e", "process.stdout.write('closed-ok')"],
      signal: new AbortController().signal,
    });
    assert.deepEqual(result, { stdout: "closed-ok", stderr: "" });
  });

  await t.test("nonzero child", async () => {
    await assert.rejects(
      defaultCommandRunner({
        file: process.execPath,
        args: ["-e", "process.stderr.write('expected'); process.exit(7)"],
        signal: new AbortController().signal,
      }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "command_failed" && error.cause?.code === 7,
    );
  });

  await t.test("aborted child is killed and reaped", async () => {
    const controller = new AbortController();
    let terminate;
    const pending = defaultCommandRunner({
      file: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      signal: controller.signal,
      registerTermination(handler) { terminate = handler; },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await assert.rejects(pending, (error) => error instanceof LinuxReleaseRuntimeError && error.code === "command_failed");
    assert.equal(await terminate(), true, "termination proof requires the child close event");
  });
});

test("actual verifier materializes an empty-VPS shadow without public routing", async () => {
  const h = await fixture();
  try {
    const result = await h.runtime.withExclusiveLock(() => h.controller.deploy({
      mode: "shadow",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      attestationPath: h.nextAttestationPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }));
    assert.equal(result.switched, false);
    assert.equal(result.targetSlot, "blue");
    assert.equal(await readFile(path.join(h.config.slots.blue.releaseDir, "runtime", "app", "server.js"), "utf8"), 'console.log("next")\n');
    const identityEnv = await readFile(path.join(h.config.slots.blue.releaseDir, ".moawork-release.env"), "utf8");
    assert.match(identityEnv, new RegExp(`MOAWORK_BUILD_SHA=${h.nextArtifact.sourceSha}`, "u"));
    assert.match(identityEnv, new RegExp(`MOAWORK_RELEASE_SHA=${h.nextArtifact.sourceSha}`, "u"));
    assert.match(identityEnv, new RegExp(`MOAWORK_ARTIFACT_SHA256=${h.nextArtifact.releaseId}`, "u"));
    assert.doesNotMatch(identityEnv, /MOAWORK_RELEASE_ID/u);
    assert.deepEqual(
      Object.keys(SOURCECORE_SELF_HOSTED_READY).sort(),
      [
        "analytics", "artifact", "artifactSha256", "buildSha", "configuration",
        "configurationFingerprint", "releaseSha", "revision", "runtime", "serverActions",
        "serverActionsKeyFingerprint", "service", "status",
      ],
    );
    assert.equal(Object.hasOwn(SOURCECORE_SELF_HOSTED_READY, "ok"), false);
    assert.equal(Object.hasOwn(SOURCECORE_SELF_HOSTED_READY, "releaseId"), false);
    assert.equal(Object.hasOwn(SOURCECORE_SELF_HOSTED_READY, "sourceSha"), false);
    assert.deepEqual(h.commands, [
      "systemctl show moawork-web-blue.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
      "systemctl stop moawork-web-blue.service",
      "systemctl restart moawork-web-blue.service",
    ]);
    await assert.rejects(() => readFile(h.config.upstreamFile), { code: "ENOENT" });
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, null);
    assert.equal(state.slots.blue.artifact.releaseId, h.nextArtifact.releaseId);
  } finally {
    await h.cleanup();
  }
});

test("first cutover CLI prepares without an active receipt and confirms only after exact public self-hosted health", async () => {
  const h = await fixture();
  try {
    const configPath = path.join(path.dirname(h.config.stateFile), "release-config.json");
    await writeFile(configPath, `${JSON.stringify(h.config, null, 2)}\n`);
    const dependencies = { runtimeDependencies: { commandRunner: h.commandRunner, fetchImpl: h.fetchImpl, resolveServiceIdentity: h.resolveServiceIdentity } };
    await runReleaseCli([
      "deploy", "--config", configPath,
      "--mode", "shadow",
      "--archive", h.nextArtifact.archivePath,
      "--manifest", h.nextArtifact.manifestPath,
      "--attestation", h.nextAttestationPath,
      "--source-sha", h.nextArtifact.sourceSha,
    ], dependencies);
    h.setPublicVercel(h.oldArtifact.sourceSha);
    const common = [
      "--config", configPath,
      "--slot", "blue",
      "--artifact-sha256", h.nextArtifact.releaseId,
      "--source-sha", h.nextArtifact.sourceSha,
    ];
    const prepared = await runReleaseCli([
      "first-cutover-prepare", ...common,
      "--rollback-url", "https://moawork-reviewed.vercel.app/api/health/ready",
      "--rollback-source-sha", h.oldArtifact.sourceSha,
      "--rollback-server-actions-fingerprint", FIXTURE_SERVER_ACTIONS_FINGERPRINT,
    ], dependencies);
    assert.equal(prepared.phase, "prepared");
    assert.equal(prepared.activeRegistered, false);
    assert.equal(prepared.dnsMutationPerformed, false);
    assert.equal(prepared.status.activeSlot, null);
    assert.equal(prepared.status.recovery.kind, "initial_cutover_pending");
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31101\n");

    h.setPublicPort(h.config.slots.blue.port);
    const confirmed = await runReleaseCli(["first-cutover-confirm", ...common], dependencies);
    assert.equal(confirmed.phase, "confirmed");
    assert.equal(confirmed.activeRegistered, true);
    assert.equal(confirmed.status.activeSlot, "blue");
    assert.equal(confirmed.status.previousSlot, null);
    assert.equal(confirmed.status.recovery, null);
    assert.equal(confirmed.status.generation, 2);
  } finally {
    await h.cleanup();
  }
});

test("first cutover abort requires restored Vercel health before removing the staged VPS route", async () => {
  const h = await fixture();
  try {
    await h.runtime.withExclusiveLock(() => h.controller.deploy({
      mode: "shadow",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      attestationPath: h.nextAttestationPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }));
    const rollbackTarget = {
      provider: "vercel",
      healthUrl: "https://moawork-reviewed.vercel.app/api/health/ready",
      serverActionsKeyFingerprint: FIXTURE_SERVER_ACTIONS_FINGERPRINT,
      sourceSha: h.oldArtifact.sourceSha,
    };
    h.setPublicVercel(h.oldArtifact.sourceSha);
    const identity = {
      targetSlot: "blue",
      sourceSha: h.nextArtifact.sourceSha,
      artifactSha256: h.nextArtifact.releaseId,
    };
    await h.runtime.withExclusiveLock(() => h.controller.prepareInitialCutover({ ...identity, rollbackTarget }));
    h.setPublicVercel(h.nextArtifact.sourceSha);
    await assert.rejects(
      h.runtime.withExclusiveLock(() => h.controller.abortInitialCutover(identity)),
      /has not restored/u,
    );
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31101\n");

    h.setPublicVercel(h.oldArtifact.sourceSha);
    const aborted = await h.runtime.withExclusiveLock(() => h.controller.abortInitialCutover(identity));
    assert.equal(aborted.phase, "aborted");
    assert.equal(aborted.status.activeSlot, null);
    assert.equal(aborted.status.recovery, null);
    await assert.rejects(() => readFile(h.config.upstreamFile), { code: "ENOENT" });
  } finally {
    await h.cleanup();
  }
});

test("activation uses exact service, candidate health, Caddy validation, CAS state, and public identity", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    const result = await h.runtime.withExclusiveLock(() => h.controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      attestationPath: h.nextAttestationPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }));
    assert.equal(result.status.activeSlot, "green");
    assert.equal(result.status.previousSlot, "blue");
    assert.equal(result.status.generation, 1);
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31102\n");
    assert.deepEqual(h.commands, [
      "systemctl show moawork-web-green.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
      "systemctl stop moawork-web-green.service",
      "systemctl restart moawork-web-green.service",
      `caddy validate --config ${h.config.caddyConfigFile}`,
      "systemctl reload caddy.service",
    ]);
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.slots.blue.state, "running");
    assert.equal(state.slots.green.state, "active");
  } finally {
    await h.cleanup();
  }
});

test("a committed switch survives response loss and explicit rollback restores the retained slot", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    let loseResponse = true;
    const runtime = {
      ...h.runtime,
      async switchActive(input) {
        const result = await h.runtime.switchActive(input);
        if (loseResponse) {
          loseResponse = false;
          throw new Error("switch response lost");
        }
        return result;
      },
    };
    const controller = await createProductionReleaseSlots({ runtime, slotIds: h.config.slotIds, timeoutMs: h.config.timeoutMs, trustedBuilderPublicKeyPath: h.config.trustedBuilderPublicKeyPath });
    const deployed = await h.runtime.withExclusiveLock(() => controller.deploy({
      mode: "activate",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      attestationPath: h.nextAttestationPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }));
    assert.equal(deployed.status.activeSlot, "green");
    assert.equal(deployed.status.generation, 1);
    const rolledBack = await h.runtime.withExclusiveLock(() => controller.rollback());
    assert.equal(rolledBack.status.activeSlot, "blue");
    assert.equal(rolledBack.status.previousSlot, "green");
    assert.equal(rolledBack.status.generation, 2);
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31101\n");
  } finally {
    await h.cleanup();
  }
});

test("Caddy validation failure restores routing and leaves state/version unchanged", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    h.faults.add(`caddy validate --config ${h.config.caddyConfigFile}`);
    await assert.rejects(
      h.runtime.withExclusiveLock(() => h.controller.deploy({
        mode: "activate",
        archivePath: h.nextArtifact.archivePath,
        manifestPath: h.nextArtifact.manifestPath,
        attestationPath: h.nextAttestationPath,
        expectedSourceSha: h.nextArtifact.sourceSha,
      })),
      /switch was not committed/u,
    );
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31101\n");
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, "blue");
    assert.equal(state.generation, 0);
    assert.equal(h.commands.includes("systemctl reload caddy.service"), false);
  } finally {
    await h.cleanup();
  }
});

test("Caddy validation plus prior-route restore failure persists recovery and retains the original failure context", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    h.faults.add(`caddy validate --config ${h.config.caddyConfigFile}`);
    let upstreamWrites = 0;
    const runtime = await createLinuxReleaseRuntime(h.config, {
      commandRunner: h.commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      beforeAtomicWrite({ target }) {
        if (target === h.config.upstreamFile && ++upstreamWrites === 2) throw new Error("injected prior-route restore failure");
      },
    });
    await runtime.withExclusiveLock(async () => {
      await runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
      await runtime.startCandidate({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
      await assert.rejects(
        runtime.switchActive({
          expectedActiveSlot: "blue",
          expectedGeneration: 0,
          targetSlot: "green",
          artifact: h.nextArtifact,
          signal: new AbortController().signal,
        }),
        (error) => error instanceof LinuxReleaseRuntimeError
          && error.code === "timeout"
          && error.cause instanceof AggregateError
          && error.cause.errors.some((cause) => /fault: caddy validate/u.test(cause.message))
          && error.cause.errors.some((cause) => /injected prior-route restore failure/u.test(cause.message)),
      );
    });
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.recovery.kind, "caddy_switch_unknown");
    assert.equal(state.activeSlot, "blue");
  } finally {
    await h.cleanup();
  }
});

test("Caddy reload failure restores the old route, reloads it once, and does not commit state", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    h.faults.add("systemctl reload caddy.service");
    await assert.rejects(
      h.runtime.withExclusiveLock(() => h.controller.deploy({
        mode: "activate",
        archivePath: h.nextArtifact.archivePath,
        manifestPath: h.nextArtifact.manifestPath,
        attestationPath: h.nextAttestationPath,
        expectedSourceSha: h.nextArtifact.sourceSha,
      })),
      /switch was not committed/u,
    );
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31101\n");
    assert.equal(h.commands.filter((entry) => entry === "systemctl reload caddy.service").length, 2);
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, "blue");
    assert.equal(state.generation, 0);
  } finally {
    await h.cleanup();
  }
});

test("reload commit with response loss uses an independent signal and proves the restored public release", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    await h.runtime.withExclusiveLock(async () => {
      await h.runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
      await h.runtime.startCandidate({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
    });
    h.commands.length = 0;
    let reloadCalls = 0;
    let markReloaded;
    const reloaded = new Promise((resolve) => { markReloaded = resolve; });
    const commandRunner = async (input) => {
      const isReload = path.basename(input.file) === "systemctl" && input.args.join(" ") === "reload caddy.service";
      if (!isReload) return h.commandRunner(input);
      reloadCalls += 1;
      if (reloadCalls === 1) {
        await h.commandRunner(input);
        markReloaded();
        return new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      }
      return h.commandRunner(input);
    };
    const runtime = await createLinuxReleaseRuntime(h.config, { commandRunner, fetchImpl: h.fetchImpl, resolveServiceIdentity: h.resolveServiceIdentity });
    const controller = new AbortController();
    const switched = runtime.withExclusiveLock(() => runtime.switchActive({
      expectedActiveSlot: "blue",
      expectedGeneration: 0,
      targetSlot: "green",
      artifact: h.nextArtifact,
      signal: controller.signal,
    }));
    await reloaded;
    controller.abort(new Error("reload response lost"));
    await assert.rejects(switched, /reload response lost/u);
    assert.equal(reloadCalls, 2);
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31101\n");
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, "blue");
    assert.equal(state.generation, 0);
    const publicBody = JSON.parse(await (await h.fetchImpl(h.config.publicHealthUrl)).text());
    assert.equal(publicBody.artifactSha256, h.oldArtifact.releaseId);
  } finally {
    await h.cleanup();
  }
});

test("failed compensation stays terminal-unknown instead of claiming the restored file is live", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    await h.runtime.withExclusiveLock(async () => {
      await h.runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
      await h.runtime.startCandidate({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
    });
    h.commands.length = 0;
    let reloadCalls = 0;
    let markReloaded;
    const reloaded = new Promise((resolve) => { markReloaded = resolve; });
    const commandRunner = async (input) => {
      const isReload = path.basename(input.file) === "systemctl" && input.args.join(" ") === "reload caddy.service";
      if (!isReload) return h.commandRunner(input);
      reloadCalls += 1;
      if (reloadCalls === 1) {
        await h.commandRunner(input);
        markReloaded();
        return new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      }
      throw new Error("compensating reload failed");
    };
    const runtime = await createLinuxReleaseRuntime(h.config, { commandRunner, fetchImpl: h.fetchImpl, resolveServiceIdentity: h.resolveServiceIdentity });
    const controller = new AbortController();
    const switched = runtime.withExclusiveLock(() => runtime.switchActive({
      expectedActiveSlot: "blue",
      expectedGeneration: 0,
      targetSlot: "green",
      artifact: h.nextArtifact,
      signal: controller.signal,
    }));
    await reloaded;
    controller.abort(new Error("reload response lost"));
    await assert.rejects(
      switched,
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "timeout" && /outcome/u.test(error.message),
    );
    assert.equal(reloadCalls, 2);
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31101\n");
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, "blue");
    assert.equal(state.generation, 0);
    assert.deepEqual(state.recovery, {
      kind: "caddy_switch_unknown",
      expectedActiveSlot: "blue",
      expectedGeneration: 0,
      targetSlot: "green",
    });
    const publicBody = JSON.parse(await (await h.fetchImpl(h.config.publicHealthUrl)).text());
    assert.equal(publicBody.artifactSha256, h.nextArtifact.releaseId, "live routing remains unknown despite the restored file");
    await assert.rejects(
      runtime.withExclusiveLock(() => runtime.status({ signal: new AbortController().signal })),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "recovery_required",
    );
  } finally {
    await h.cleanup();
  }
});

test("a failed recovery-state write installs an upstream sentinel before releasing the lock", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    await h.runtime.withExclusiveLock(async () => {
      await h.runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
      await h.runtime.startCandidate({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
    });
    h.commands.length = 0;
    let reloadCalls = 0;
    let markReloaded;
    const reloaded = new Promise((resolve) => { markReloaded = resolve; });
    const commandRunner = async (input) => {
      const isReload = path.basename(input.file) === "systemctl" && input.args.join(" ") === "reload caddy.service";
      if (!isReload) return h.commandRunner(input);
      reloadCalls += 1;
      if (reloadCalls === 1) {
        await h.commandRunner(input);
        markReloaded();
        return new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      }
      throw new Error("compensating reload failed");
    };
    const runtime = await createLinuxReleaseRuntime(h.config, {
      commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      beforeAtomicWrite({ target, bytes }) {
        if (target === h.config.stateFile && bytes.includes(Buffer.from("caddy_switch_unknown"))) {
          throw new Error("recovery state write failed");
        }
      },
    });
    const controller = new AbortController();
    const switched = runtime.withExclusiveLock(() => runtime.switchActive({
      expectedActiveSlot: "blue",
      expectedGeneration: 0,
      targetSlot: "green",
      artifact: h.nextArtifact,
      signal: controller.signal,
    }));
    await reloaded;
    controller.abort(new Error("reload response lost"));
    await assert.rejects(
      switched,
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "timeout" && /sentinel/u.test(error.message),
    );
    assert.equal(reloadCalls, 2);
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, "blue");
    assert.equal(state.generation, 0);
    assert.equal(state.recovery, null);
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "# moawork recovery required\n");
    await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
    await assert.rejects(
      runtime.withExclusiveLock(() => runtime.status({ signal: new AbortController().signal })),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "state_invalid",
    );
    assert.equal(reloadCalls, 2, "status must not mutate Caddy after the sentinel blocks state reconciliation");
  } finally {
    await h.cleanup();
  }
});

test("failed recovery-state and sentinel writes retain the exclusive lock and block every next action", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    await h.runtime.withExclusiveLock(async () => {
      await h.runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
      await h.runtime.startCandidate({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
    });
    h.commands.length = 0;
    let reloadCalls = 0;
    let markReloaded;
    const reloaded = new Promise((resolve) => { markReloaded = resolve; });
    const commandRunner = async (input) => {
      const isReload = path.basename(input.file) === "systemctl" && input.args.join(" ") === "reload caddy.service";
      if (!isReload) return h.commandRunner(input);
      reloadCalls += 1;
      if (reloadCalls === 1) {
        await h.commandRunner(input);
        markReloaded();
        return new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      }
      throw new Error("compensating reload failed");
    };
    const sentinel = Buffer.from("# moawork recovery required\n");
    const runtime = await createLinuxReleaseRuntime(h.config, {
      commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      beforeAtomicWrite({ target, bytes }) {
        if (target === h.config.stateFile && bytes.includes(Buffer.from("caddy_switch_unknown"))) {
          throw new Error("recovery state write failed");
        }
        if (target === h.config.upstreamFile && bytes.equals(sentinel)) {
          throw new Error("recovery sentinel write failed");
        }
      },
    });
    const controller = new AbortController();
    const switched = runtime.withExclusiveLock(() => runtime.switchActive({
      expectedActiveSlot: "blue",
      expectedGeneration: 0,
      targetSlot: "green",
      artifact: h.nextArtifact,
      signal: controller.signal,
    }));
    await reloaded;
    controller.abort(new Error("reload response lost"));
    await assert.rejects(
      switched,
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "timeout" && /lock was retained/u.test(error.message),
    );
    assert.equal(reloadCalls, 2);
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, "blue");
    assert.equal(state.generation, 0);
    assert.equal(state.recovery, null);
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31101\n");
    assert.deepEqual(JSON.parse(await readFile(h.config.lockFile, "utf8")), {
      schema: 1,
      state: "recovery_required",
      pid: process.pid,
    });
    let actionInvoked = false;
    await assert.rejects(
      runtime.withExclusiveLock(async () => { actionInvoked = true; }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "lock_busy",
    );
    assert.equal(actionInvoked, false);
    assert.equal(reloadCalls, 2);
  } finally {
    await h.cleanup();
  }
});

test("candidate identity failure stops and removes only the inactive candidate", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    h.unhealthyPorts.add(h.config.slots.green.port);
    await assert.rejects(
      h.runtime.withExclusiveLock(() => h.controller.deploy({
        mode: "activate",
        archivePath: h.nextArtifact.archivePath,
        manifestPath: h.nextArtifact.manifestPath,
        attestationPath: h.nextAttestationPath,
        expectedSourceSha: h.nextArtifact.sourceSha,
      })),
      /candidate health did not prove/u,
    );
    assert.equal(await readFile(path.join(h.config.slots.blue.releaseDir, "runtime", "app", "server.js"), "utf8"), 'console.log("old")\n');
    await assert.rejects(() => readFile(h.config.slots.green.releaseDir), { code: "ENOENT" });
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, "blue");
    assert.equal(state.slots.green.state, "empty");
    assert.equal(h.commands.at(-1), "systemctl stop moawork-web-green.service");
  } finally {
    await h.cleanup();
  }
});

test("the legacy verified flag cannot replace an exact artifact digest", async (t) => {
  for (const mode of ["missing", "wrong"]) {
    await t.test(mode, async () => {
      const h = await fixture();
      try {
        await h.seedActive(h.oldArtifact);
        if (mode === "missing") h.artifactFlagOnlyPorts.add(h.config.slots.green.port);
        else h.wrongArtifactPorts.add(h.config.slots.green.port);
        await assert.rejects(
          h.runtime.withExclusiveLock(() => h.controller.deploy({
            mode: "activate",
            archivePath: h.nextArtifact.archivePath,
            manifestPath: h.nextArtifact.manifestPath,
            attestationPath: h.nextAttestationPath,
            expectedSourceSha: h.nextArtifact.sourceSha,
          })),
          /candidate health did not prove/u,
        );
        const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
        assert.equal(state.activeSlot, "blue");
        assert.equal(state.generation, 0);
      } finally {
        await h.cleanup();
      }
    });
  }
});

test("corrupted artifact performs zero runtime commands and cannot replace the active release", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    const archive = await readFile(h.nextArtifact.archivePath);
    archive[700] ^= 0xff;
    await writeFile(h.nextArtifact.archivePath, archive);
    await assert.rejects(
      h.runtime.withExclusiveLock(() => h.controller.deploy({
        mode: "activate",
        archivePath: h.nextArtifact.archivePath,
        manifestPath: h.nextArtifact.manifestPath,
        attestationPath: h.nextAttestationPath,
        expectedSourceSha: h.nextArtifact.sourceSha,
      })),
      (error) => error?.code === "ARCHIVE_DIGEST",
    );
    assert.deepEqual(h.commands, []);
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, "blue");
  } finally {
    await h.cleanup();
  }
});

test("lock is mandatory, exclusive, and released without invoking shells or sudo", async () => {
  const h = await fixture();
  try {
    await assert.rejects(() => h.runtime.status({ signal: new AbortController().signal }), (error) => error instanceof LinuxReleaseRuntimeError && error.code === "lock_required");
    await writeFile(h.config.lockFile, "occupied\n", { mode: 0o600 });
    await assert.rejects(() => h.runtime.withExclusiveLock(() => Promise.resolve()), (error) => error instanceof LinuxReleaseRuntimeError && error.code === "lock_busy");
    await rm(h.config.lockFile, { force: true });
    await h.runtime.withExclusiveLock(() => h.runtime.status({ signal: new AbortController().signal }));
    await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
    assert.equal(h.commands.some((command) => /(?:sudo|sh -c|bash)/u.test(command)), false);
  } finally {
    await h.cleanup();
  }
});

test("a timed-out materialization keeps the lock until abort cleanup settles", async () => {
  const h = await fixture();
  try {
    let markStarted;
    let markAborted;
    let allowSettle;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const aborted = new Promise((resolve) => { markAborted = resolve; });
    const settle = new Promise((resolve) => { allowSettle = resolve; });
    const runtime = await createLinuxReleaseRuntime(h.config, {
      commandRunner: h.commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      async materializeArtifact({ destinationPath, signal }) {
        await writeFile(path.join(path.dirname(destinationPath), "partial-write"), "partial\n");
        markStarted();
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        markAborted();
        await settle;
        throw signal.reason;
      },
    });
    const controller = createReleaseSlots({
      verifyReleaseArtifact: async () => h.nextArtifact,
      runtime,
      slotIds: h.config.slotIds,
      timeoutMs: 50,
    });
    const first = runtime.withExclusiveLock(() => controller.deploy({
      mode: "shadow",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      attestationPath: h.nextAttestationPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }));
    await started;
    await aborted;
    await assert.rejects(
      runtime.withExclusiveLock(() => Promise.resolve()),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "lock_busy",
    );
    assert.equal(await readFile(h.config.lockFile, "utf8").then((value) => value.length > 0), true);
    allowSettle();
    await assert.rejects(first, (error) => error?.code === "timeout");
    await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
    assert.deepEqual(await readdir(h.config.releaseRoot), []);
    await assert.rejects(() => readFile(h.config.stateFile), { code: "ENOENT" });
    assert.deepEqual(h.commands, [
      "systemctl show moawork-web-blue.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
    ]);
  } finally {
    await h.cleanup();
  }
});

test("config fails closed for overlapping ports, foreign units, relative paths, and Caddy drift", async () => {
  const h = await fixture();
  try {
    await assert.rejects(
      createLinuxReleaseRuntime({ ...h.config, slots: { ...h.config.slots, green: { ...h.config.slots.green, port: h.config.slots.blue.port } } }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "invalid_config",
    );
    await assert.rejects(
      createLinuxReleaseRuntime({ ...h.config, slots: { ...h.config.slots, green: { ...h.config.slots.green, unit: "salespt-green.service" } } }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "invalid_config",
    );
    await assert.rejects(
      createLinuxReleaseRuntime({ ...h.config, stateFile: "relative-state.json" }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "invalid_config",
    );
    await assert.rejects(
      createLinuxReleaseRuntime({ ...h.config, upstreamFile: h.config.stateFile }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "invalid_config",
    );
    const hardlinkedTrustPath = path.join(path.dirname(h.config.runtimeEnvFile), "hardlinked-builder.pub.pem");
    await link(h.config.nodePath, hardlinkedTrustPath);
    const hardlinkRuntime = await createLinuxReleaseRuntime({ ...h.config, trustedBuilderPublicKeyPath: hardlinkedTrustPath }, {
      commandRunner: h.commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
    });
    await assert.rejects(
      hardlinkRuntime.withExclusiveLock(() => Promise.resolve()),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract",
    );
    await assert.rejects(
      createLinuxReleaseRuntime({ ...h.config, slots: { ...h.config.slots, green: { ...h.config.slots.green, releaseDir: h.config.slots.blue.releaseDir } } }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "invalid_config",
    );
    await assert.rejects(
      createLinuxReleaseRuntime({
        ...h.config,
        slots: {
          blue: { ...h.config.slots.blue, unit: "moawork-web-blue-green.service" },
          green: { ...h.config.slots.green, unit: "moawork-web-blue-green.service" },
        },
      }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "invalid_config",
    );
    await assert.rejects(
      createLinuxReleaseRuntime({
        ...h.config,
        slots: {
          blue: { ...h.config.slots.blue, unit: "moawork-web-green.service" },
          green: { ...h.config.slots.green, unit: "moawork-web-blue.service" },
        },
      }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "invalid_config",
    );
    assert.deepEqual(h.commands, []);
    await writeFile(h.config.caddyConfigFile, "drift\n");
    await assert.rejects(
      h.runtime.withExclusiveLock(() => Promise.resolve()),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract",
    );
    await writeFile(h.config.caddyConfigFile, `${h.config.caddyImportLine}\n`);
    await writeFile(h.config.caddySiteFile, "drift\n");
    await assert.rejects(
      h.runtime.withExclusiveLock(() => Promise.resolve()),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract",
    );
    await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
  } finally {
    await h.cleanup();
  }
});

test("physical host isolation rejects linked ancestors and output-to-input hardlink aliases before lock or commands", async (t) => {
  await t.test("linked state ancestor", async () => {
    const h = await fixture();
    try {
      const linkedStateRoot = path.join(path.dirname(h.config.runtimeEnvFile), "linked-state-root");
      await symlink(path.dirname(h.config.stateFile), linkedStateRoot, process.platform === "win32" ? "junction" : "dir");
      const runtime = await createLinuxReleaseRuntime({
        ...h.config,
        stateFile: path.join(linkedStateRoot, "release-state.json"),
      }, {
        commandRunner: h.commandRunner,
        fetchImpl: h.fetchImpl,
        resolveServiceIdentity: h.resolveServiceIdentity,
      });
      await assert.rejects(
        runtime.withExclusiveLock(() => Promise.resolve()),
        (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract" && /symlink or junction/u.test(error.message),
      );
      assert.deepEqual(h.commands, []);
      await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
      await assert.rejects(() => readFile(h.config.stateFile), { code: "ENOENT" });
    } finally {
      await h.cleanup();
    }
  });

  await t.test("existing state aliases Node executable", async () => {
    const h = await fixture();
    try {
      await link(h.config.nodePath, h.config.stateFile);
      await assert.rejects(
        h.runtime.withExclusiveLock(() => Promise.resolve()),
        (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract" && /aliases/u.test(error.message),
      );
      assert.deepEqual(h.commands, []);
      await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
    } finally {
      await h.cleanup();
    }
  });
});

test("a missing or drifted systemd unit contract stops before service mutation", async () => {
  const h = await fixture();
  try {
    h.faults.add("systemctl show moawork-web-blue.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths");
    await assert.rejects(h.runtime.withExclusiveLock(() => h.controller.deploy({
      mode: "shadow",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      attestationPath: h.nextAttestationPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    })), /fault: systemctl show/u);
    assert.deepEqual(h.commands, ["systemctl show moawork-web-blue.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths"]);
    await assert.rejects(() => readFile(h.config.stateFile), { code: "ENOENT" });

    h.commands.length = 0;
    const resourceDriftRuntime = await createLinuxReleaseRuntime(h.config, {
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      commandRunner: async (input) => {
        const result = await h.commandRunner(input);
        return { ...result, stdout: result.stdout.replace("MemoryMax=536870912", "MemoryMax=infinity") };
      },
    });
    const resourceDriftController = await createProductionReleaseSlots({
      runtime: resourceDriftRuntime,
      slotIds: h.config.slotIds,
      timeoutMs: h.config.timeoutMs,
      trustedBuilderPublicKeyPath: h.config.trustedBuilderPublicKeyPath,
    });
    await assert.rejects(resourceDriftRuntime.withExclusiveLock(() => resourceDriftController.deploy({
      mode: "shadow",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      attestationPath: h.nextAttestationPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    })), (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract");
    await assert.rejects(() => readFile(h.config.stateFile), { code: "ENOENT" });
  } finally {
    await h.cleanup();
  }
});

test("systemd contract rejects duplicate, extra, shell, environment, and resource drift before state", async (t) => {
  const cases = [
    ["duplicate property", (output) => output.replace("User=moawork\n", "User=moawork\nUser=moawork\n")],
    ["unknown extra property", (output) => `${output}Unexpected=value\n`],
    ["explicit group override", (output) => output.replace("Group=\n", "Group=moawork\n")],
    ["third environment file", (output) => output.replace(" (ignore_errors=no)\nExecStart=", " (ignore_errors=no) /tmp/extra.env (ignore_errors=no)\nExecStart=")],
    ["extra Node argument", (output) => output.replace(" server.js ; }", " server.js --inspect ; }")],
    ["shell argument", (output) => output.replace(" server.js ; }", " server.js sh -c payload ; }")],
    ["garbage restart", (output) => output.replace("RestartUSec=5s", "RestartUSec=eventually")],
    ["huge restart", (output) => output.replace("RestartUSec=5s", "RestartUSec=999999h")],
    ["huge memory", (output) => output.replace("MemoryMax=536870912", "MemoryMax=999999999999999999999")],
    ["huge tasks", (output) => output.replace("TasksMax=128", "TasksMax=999999999999999999999")],
    ["huge CPU quota", (output) => output.replace("CPUQuotaPerSecUSec=500ms", "CPUQuotaPerSecUSec=999999h")],
    ["new privileges enabled", (output) => output.replace("NoNewPrivileges=yes", "NoNewPrivileges=no")],
    ["private tmp disabled", (output) => output.replace("PrivateTmp=yes", "PrivateTmp=no")],
    ["filesystem protection weakened", (output) => output.replace("ProtectSystem=strict", "ProtectSystem=full")],
    ["home protection weakened", (output) => output.replace("ProtectHome=yes", "ProtectHome=no")],
    ["write path widened", (output) => output.replace(/^ReadWritePaths=.*$/mu, "ReadWritePaths=/")],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const h = await fixture();
      try {
        const runtime = await createLinuxReleaseRuntime(h.config, {
          fetchImpl: h.fetchImpl,
          resolveServiceIdentity: h.resolveServiceIdentity,
          commandRunner: async (input) => {
            const result = await h.commandRunner(input);
            return input.args[0] === "show" ? { ...result, stdout: mutate(result.stdout) } : result;
          },
        });
        const controller = await createProductionReleaseSlots({
          runtime,
          slotIds: h.config.slotIds,
          timeoutMs: h.config.timeoutMs,
          trustedBuilderPublicKeyPath: h.config.trustedBuilderPublicKeyPath,
        });
        await assert.rejects(
          runtime.withExclusiveLock(() => controller.deploy({
            mode: "shadow",
            archivePath: h.nextArtifact.archivePath,
            manifestPath: h.nextArtifact.manifestPath,
            attestationPath: h.nextAttestationPath,
            expectedSourceSha: h.nextArtifact.sourceSha,
          })),
          (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract",
        );
        assert.deepEqual(h.commands, [
          "systemctl show moawork-web-blue.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
        ]);
        await assert.rejects(() => readFile(h.config.stateFile), { code: "ENOENT" });
        await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
      } finally {
        await h.cleanup();
      }
    });
  }
});

test("native Linux rejects deploy and service identity collapse before lock or commands", {
  skip: process.platform !== "linux" ? "native ownership identity is Linux-only" : false,
}, async () => {
  const h = await fixture();
  try {
    await assert.rejects(
      createLinuxReleaseRuntime(h.config, {
        commandRunner: h.commandRunner,
        fetchImpl: h.fetchImpl,
        resolveServiceIdentity: async () => ({ uid: BigInt(process.getuid()), gid: BigInt(process.getgid()), groups: [BigInt(process.getgid())] }),
      }),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract" && /distinct/u.test(error.message),
    );
    assert.deepEqual(h.commands, []);
    await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
  } finally {
    await h.cleanup();
  }
});

test("release sealing fails before service mutation and preserves empty state on mode or identity errors", async (t) => {
  for (const [name, releaseFileSystem] of [
    ...(process.platform === "linux" ? [["ownership failure", {
      async chown() {
        throw new Error("injected chown failure");
      },
    }]] : []),
    ["mode failure", {
      async chmod(target, mode) {
        if (target.endsWith(path.join("runtime", "app", "server.js")) && mode === 0o440) throw new Error("injected chmod failure");
        return chmod(target, mode);
      },
    }],
    ["identity drift", (() => {
      let sealedServer = false;
      let drifted = false;
      return {
        async chmod(target, mode) {
          if (target.endsWith(path.join("runtime", "app", "server.js")) && mode === 0o440) sealedServer = true;
          return chmod(target, mode);
        },
        async lstat(target, options) {
          const value = await lstat(target, options);
          if (!sealedServer || drifted || !target.endsWith(path.join("runtime", "app", "server.js"))) return value;
          drifted = true;
          return new Proxy(value, { get(object, property) { return property === "ino" ? object.ino + 1n : Reflect.get(object, property); } });
        },
      };
    })()],
  ]) {
    await t.test(name, async () => {
      const h = await fixture();
      try {
        const runtime = await createLinuxReleaseRuntime(h.config, {
          commandRunner: h.commandRunner,
          fetchImpl: h.fetchImpl,
          resolveServiceIdentity: h.resolveServiceIdentity,
          releaseFileSystem,
        });
        const controller = await createProductionReleaseSlots({
          runtime,
          slotIds: h.config.slotIds,
          timeoutMs: h.config.timeoutMs,
          trustedBuilderPublicKeyPath: h.config.trustedBuilderPublicKeyPath,
        });
        await assert.rejects(
          runtime.withExclusiveLock(() => controller.deploy({
            mode: "shadow",
            archivePath: h.nextArtifact.archivePath,
            manifestPath: h.nextArtifact.manifestPath,
            attestationPath: h.nextAttestationPath,
            expectedSourceSha: h.nextArtifact.sourceSha,
          })),
          (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract",
        );
        assert.deepEqual(h.commands, [
          "systemctl show moawork-web-blue.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
        ]);
        await assert.rejects(() => readFile(h.config.stateFile), { code: "ENOENT" });
        assert.deepEqual(await readdir(h.config.releaseRoot), []);
      } finally {
        await h.cleanup();
      }
    });
  }
});

test("release sealing rejects an external hardlink without changing the outside inode", async () => {
  const h = await fixture();
  const outside = path.join(path.dirname(h.config.releaseRoot), "outside-server.js");
  try {
    let before;
    let bytesBefore;
    const runtime = await createLinuxReleaseRuntime(h.config, {
      commandRunner: h.commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      async materializeArtifact({ destinationPath }) {
        const server = path.join(destinationPath, "runtime", "app", "server.js");
        await mkdir(path.dirname(server), { recursive: true });
        await writeFile(server, "outside-alias-proof\n", { mode: 0o600 });
        await link(server, outside);
        before = await stat(outside, { bigint: true });
        bytesBefore = await readFile(outside);
        return h.nextArtifact;
      },
    });
    await assert.rejects(
      runtime.withExclusiveLock(() => runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal })),
      (error) => error instanceof LinuxReleaseRuntimeError
        && error.code === "compensation_failed"
        && error.cause instanceof LinuxReleaseRuntimeError
        && /hardlink/u.test(error.cause.message),
    );
    const after = await stat(outside, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, before.gid);
    assert.deepEqual(await readFile(outside), bytesBefore);
    assert.deepEqual(h.commands, [
      "systemctl show moawork-web-blue.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
    ]);
    await assert.rejects(() => readFile(h.config.stateFile), { code: "ENOENT" });
    assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
  } finally {
    await rm(outside, { force: true });
    await h.cleanup();
  }
});

test("late cleanup aliases and substituted paths fail before shared-inode chmod and retain recovery evidence", async (t) => {
  await t.test("external hardlink introduced after state verification", async () => {
    const h = await fixture();
    const outside = path.join(path.dirname(h.config.releaseRoot), "late-cleanup-alias.js");
    try {
      await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal }));
      h.commands.length = 0;
      const server = path.join(h.config.slots.blue.releaseDir, "runtime", "app", "server.js");
      let outsideBefore;
      let outsideBytesBefore;
      const commandRunner = async (input) => {
        const result = await h.commandRunner(input);
        if (input.args[0] === "stop" && input.args[1] === h.config.slots.blue.unit) {
          await link(server, outside);
          outsideBefore = await stat(outside, { bigint: true });
          outsideBytesBefore = await readFile(outside);
        }
        return result;
      };
      const runtime = await createLinuxReleaseRuntime(h.config, { commandRunner, fetchImpl: h.fetchImpl, resolveServiceIdentity: h.resolveServiceIdentity });
      await assert.rejects(
        runtime.withExclusiveLock(() => runtime.rejectCandidate({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal })),
        (error) => error instanceof LinuxReleaseRuntimeError && error.code === "cleanup_failed",
      );
      const outsideAfter = await stat(outside, { bigint: true });
      assert.deepEqual(
        [outsideAfter.dev, outsideAfter.ino, outsideAfter.mode, outsideAfter.uid, outsideAfter.gid],
        [outsideBefore.dev, outsideBefore.ino, outsideBefore.mode, outsideBefore.uid, outsideBefore.gid],
      );
      assert.deepEqual(await readFile(outside), outsideBytesBefore);
      assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
      assert.equal(JSON.parse(await readFile(h.config.stateFile, "utf8")).recovery.kind, "release_cleanup_unknown");
    } finally {
      await rm(outside, { force: true });
      await h.cleanup();
    }
  });

  await t.test("path identity substitution before cleanup chmod", async () => {
    const h = await fixture();
    try {
      await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal }));
      h.commands.length = 0;
      const server = path.join(h.config.slots.blue.releaseDir, "runtime", "app", "server.js");
      let inject = false;
      let injected = false;
      const chmodTargets = [];
      const runtime = await createLinuxReleaseRuntime(h.config, {
        commandRunner: async (input) => {
          const result = await h.commandRunner(input);
          if (input.args[0] === "stop") inject = true;
          return result;
        },
        fetchImpl: h.fetchImpl,
        resolveServiceIdentity: h.resolveServiceIdentity,
        releaseFileSystem: {
          async stat(target, options) {
            const value = await stat(target, options);
            if (!inject || injected || target !== server) return value;
            injected = true;
            return new Proxy(value, { get(object, property) { return property === "ino" ? object.ino + 1n : Reflect.get(object, property); } });
          },
          async chmod(target, mode) {
            chmodTargets.push(target);
            return chmod(target, mode);
          },
        },
      });
      await assert.rejects(
        runtime.withExclusiveLock(() => runtime.rejectCandidate({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal })),
        (error) => error instanceof LinuxReleaseRuntimeError && error.code === "cleanup_failed",
      );
      assert.equal(injected, true);
      assert.equal(chmodTargets.includes(server), false);
      assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
    } finally {
      await h.cleanup();
    }
  });
});

test("persisted release seals survive process restart and malformed or drifted seals fail closed", async (t) => {
  await t.test("fresh runtime consumes exact persisted seal", async () => {
    const h = await fixture();
    try {
      await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal }));
      h.commands.length = 0;
      const fresh = await createLinuxReleaseRuntime(h.config, { commandRunner: h.commandRunner, fetchImpl: h.fetchImpl, resolveServiceIdentity: h.resolveServiceIdentity });
      await fresh.withExclusiveLock(async () => {
        await fresh.verifyPrepared({ slot: "blue", artifact: h.nextArtifact });
        await fresh.startCandidate({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal });
      });
      assert.deepEqual(h.commands, ["systemctl restart moawork-web-blue.service"]);
      const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
      assert.match(state.slots.blue.seal.digest, /^[0-9a-f]{64}$/u);
      assert.equal(state.slots.blue.seal.schema, 1);
    } finally {
      await h.cleanup();
    }
  });

  for (const [name, mutateState, code] of [
    ["missing", (state) => { delete state.slots.blue.seal; }, "state_invalid"],
    ["malformed", (state) => { state.slots.blue.seal = { schema: 1, digest: "bad" }; }, "state_invalid"],
    ["mismatch", (state) => { state.slots.blue.seal.digest = "f".repeat(64); }, "host_contract"],
  ]) {
    await t.test(`${name} persisted seal`, async () => {
      const h = await fixture();
      try {
        await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal }));
        const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
        mutateState(state);
        await writeFile(h.config.stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
        h.commands.length = 0;
        const fresh = await createLinuxReleaseRuntime(h.config, { commandRunner: h.commandRunner, fetchImpl: h.fetchImpl, resolveServiceIdentity: h.resolveServiceIdentity });
        await assert.rejects(
          fresh.withExclusiveLock(() => fresh.startCandidate({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal })),
          (error) => error instanceof LinuxReleaseRuntimeError && error.code === code,
        );
        assert.deepEqual(h.commands, []);
      } finally {
        await h.cleanup();
      }
    });
  }
});

test("native Linux fixture seals deploy-owned service-group releases without unrelated access bits", {
  skip: process.platform !== "linux" ? "native ownership modes are Linux-only" : false,
}, async () => {
  const h = await fixture();
  try {
    await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal }));
    const releaseStats = await stat(h.config.slots.blue.releaseDir, { bigint: true });
    const fileStats = await stat(path.join(h.config.slots.blue.releaseDir, "runtime", "app", "server.js"), { bigint: true });
    for (const [entry, expectedMode] of [[releaseStats, 0o550n], [fileStats, 0o440n]]) {
      assert.equal(entry.uid, BigInt(process.getuid()));
      assert.equal(entry.gid, BigInt(process.getgid()));
      assert.equal(entry.mode & 0o777n, expectedMode);
      assert.equal(entry.mode & 0o007n, 0n);
    }
  } finally {
    await h.cleanup();
  }
});

test("native Linux rejects a non-traversable 0700 release ancestor before lock or service commands", {
  skip: process.platform !== "linux" ? "native effective-mode traversal is Linux-only" : false,
}, async () => {
  const h = await fixture();
  try {
    const parent = path.dirname(h.config.releaseRoot);
    await chmod(parent, 0o700);
    await assert.rejects(
      h.runtime.withExclusiveLock(() => Promise.resolve()),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract" && /traversable/u.test(error.message),
    );
    assert.deepEqual(h.commands, []);
    await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
  } finally {
    await h.cleanup();
  }
});

test("installed release identity drift blocks systemd restart and leaves prepared state", async () => {
  const h = await fixture();
  try {
    let drift = false;
    const runtime = await createLinuxReleaseRuntime(h.config, {
      commandRunner: h.commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      releaseFileSystem: {
        async lstat(target, options) {
          const value = await lstat(target, options);
          if (!drift || !target.endsWith(path.join("runtime", "app", "server.js"))) return value;
          return new Proxy(value, { get(object, property) { return property === "ino" ? object.ino + 1n : Reflect.get(object, property); } });
        },
      },
    });
    await runtime.withExclusiveLock(async () => {
      await runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal });
      drift = true;
      await assert.rejects(
        runtime.startCandidate({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal }),
        (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract",
      );
    });
    assert.deepEqual(h.commands, [
      "systemctl show moawork-web-blue.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
      "systemctl stop moawork-web-blue.service",
    ]);
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.slots.blue.state, "prepared");
  } finally {
    await h.cleanup();
  }
});

test("post-install identity drift restores the exact previous inactive release without state commit", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "green", artifact: h.oldArtifact, signal: new AbortController().signal }));
    h.commands.length = 0;
    let drifted = false;
    let installed = false;
    const installedServer = path.join(h.config.slots.green.releaseDir, "runtime", "app", "server.js");
    const runtime = await createLinuxReleaseRuntime(h.config, {
      commandRunner: h.commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      releaseFileSystem: {
        async rename(source, destination) {
          await rename(source, destination);
          if (destination === h.config.slots.green.releaseDir && source.includes(".materialize-")) installed = true;
        },
        async lstat(target, options) {
          const value = await lstat(target, options);
          if (!installed || drifted || target !== installedServer) return value;
          drifted = true;
          return new Proxy(value, { get(object, property) { return property === "ino" ? object.ino + 1n : Reflect.get(object, property); } });
        },
      },
    });
    const controller = await createProductionReleaseSlots({ runtime, slotIds: h.config.slotIds, timeoutMs: h.config.timeoutMs, trustedBuilderPublicKeyPath: h.config.trustedBuilderPublicKeyPath });
    await assert.rejects(
      runtime.withExclusiveLock(() => controller.deploy({
        mode: "shadow",
        archivePath: h.nextArtifact.archivePath,
        manifestPath: h.nextArtifact.manifestPath,
        attestationPath: h.nextAttestationPath,
        expectedSourceSha: h.nextArtifact.sourceSha,
      })),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract",
    );
    assert.deepEqual(h.commands, [
      "systemctl show moawork-web-green.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
      "systemctl stop moawork-web-green.service",
    ]);
    assert.equal(await readFile(installedServer, "utf8"), 'console.log("old")\n');
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.slots.green.artifact.releaseId, h.oldArtifact.releaseId);
    assert.equal(state.slots.green.state, "prepared");
  } finally {
    await h.cleanup();
  }
});

test("prepare compensation restores a prior running slot or retains the lock on exact compensation failure", async (t) => {
  async function seedRunningInactive(h) {
    await h.seedActive(h.oldArtifact);
    await h.runtime.withExclusiveLock(async () => {
      await h.runtime.prepare({ slot: "green", artifact: h.oldArtifact, signal: new AbortController().signal });
      await h.runtime.startCandidate({ slot: "green", artifact: h.oldArtifact, signal: new AbortController().signal });
    });
    h.commands.length = 0;
  }

  await t.test("failure immediately after rename restores tree, state, and service", async () => {
    const h = await fixture();
    try {
      await seedRunningInactive(h);
      let failed = false;
      const runtime = await createLinuxReleaseRuntime(h.config, {
        commandRunner: h.commandRunner,
        fetchImpl: h.fetchImpl,
        resolveServiceIdentity: h.resolveServiceIdentity,
        releaseFileSystem: {
          async rm(target, options) {
            if (!failed && path.basename(target).startsWith(".green.materialize-")) {
              failed = true;
              throw new Error("injected materialize cleanup failure");
            }
            return rm(target, options);
          },
        },
      });
      await assert.rejects(
        runtime.withExclusiveLock(() => runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal })),
        /injected materialize cleanup failure/u,
      );
      assert.deepEqual(h.commands, [
        "systemctl show moawork-web-green.service --no-pager --property=LoadState,User,Group,WorkingDirectory,EnvironmentFiles,ExecStart,Restart,RestartUSec,MemoryMax,TasksMax,CPUQuotaPerSecUSec,StandardOutput,StandardError,SyslogIdentifier,NoNewPrivileges,PrivateTmp,ProtectSystem,ProtectHome,ReadWritePaths",
        "systemctl stop moawork-web-green.service",
        "systemctl restart moawork-web-green.service",
        "systemctl show moawork-web-green.service --no-pager --property=ActiveState --value",
      ]);
      const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
      assert.equal(state.slots.green.state, "running");
      assert.equal(state.slots.green.artifact.releaseId, h.oldArtifact.releaseId);
      assert.equal(await readFile(path.join(h.config.slots.green.releaseDir, "runtime", "app", "server.js"), "utf8"), 'console.log("old")\n');
      assert.deepEqual((await readdir(h.config.releaseRoot)).sort(), ["blue", "green"]);
      await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
    } finally {
      await h.cleanup();
    }
  });

  for (const [name, makeDependencies, expectedCommands, expectedCode] of [
    ["new target removal failure", (h) => ({
      beforeAtomicWrite({ target }) {
        if (target === h.config.stateFile) throw new Error("injected state failure");
      },
      releaseFileSystem: {
        async rm(target, options) {
          if (target === h.config.slots.green.releaseDir) throw new Error("injected removal failure");
          return rm(target, options);
        },
      },
    }), ["show", "stop"], "compensation_failed"],
    ["old target restore failure", (h) => ({
      beforeAtomicWrite({ target }) {
        if (target === h.config.stateFile) throw new Error("injected state failure");
      },
      releaseFileSystem: {
        async rename(source, destination) {
          if (destination === h.config.slots.green.releaseDir && path.basename(source).startsWith(".green.previous-")) throw new Error("injected restore failure");
          return rename(source, destination);
        },
      },
    }), ["show", "stop"], "compensation_failed"],
    ["prior service restart failure", (h) => {
      let stopped = false;
      return {
        beforeAtomicWrite({ target }) {
          if (target === h.config.stateFile) throw new Error("injected state failure");
        },
        commandRunner: async (input) => {
          const command = `${path.basename(input.file)} ${input.args.join(" ")}`;
          if (command === "systemctl stop moawork-web-green.service") stopped = true;
          if (stopped && command === "systemctl restart moawork-web-green.service") {
            h.commands.push(command);
            throw new Error("injected restart failure");
          }
          return h.commandRunner(input);
        },
      };
    }, ["show", "stop", "restart", "show"], "service_state_unknown"],
  ]) {
    await t.test(name, async () => {
      const h = await fixture();
      try {
        await seedRunningInactive(h);
        const extra = makeDependencies(h);
        const runtime = await createLinuxReleaseRuntime(h.config, {
          commandRunner: extra.commandRunner ?? h.commandRunner,
          fetchImpl: h.fetchImpl,
          resolveServiceIdentity: h.resolveServiceIdentity,
          beforeAtomicWrite: extra.beforeAtomicWrite,
          releaseFileSystem: extra.releaseFileSystem,
        });
        await assert.rejects(
          runtime.withExclusiveLock(() => runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal })),
          (error) => error instanceof LinuxReleaseRuntimeError && error.code === expectedCode,
        );
        assert.equal(await readFile(h.config.lockFile, "utf8").then((value) => value.length > 0), true);
        assert.deepEqual(h.commands.map((command) => command.startsWith("systemctl show") ? "show" : command.startsWith("systemctl stop") ? "stop" : command.startsWith("systemctl restart") ? "restart" : command), expectedCommands);
        const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
        assert.equal(state.slots.green.state, "running");
        assert.equal(state.slots.green.artifact.releaseId, h.oldArtifact.releaseId);
      } finally {
        await h.cleanup();
      }
    });
  }
});

test("ambiguous systemd transitions reconcile with a fresh signal or retain exact recovery", async (t) => {
  async function seedRunningGreen(h) {
    await h.seedActive(h.oldArtifact);
    await h.runtime.withExclusiveLock(async () => {
      await h.runtime.prepare({ slot: "green", artifact: h.oldArtifact, signal: new AbortController().signal });
      await h.runtime.startCandidate({ slot: "green", artifact: h.oldArtifact, signal: new AbortController().signal });
    });
    h.commands.length = 0;
  }

  await t.test("stop response loss restores and verifies the previously running service", async () => {
    const h = await fixture();
    try {
      await seedRunningGreen(h);
      let loseStopResponse = true;
      const caller = new AbortController();
      const runtime = await createLinuxReleaseRuntime(h.config, {
        commandRunner: async (input) => {
          const result = await h.commandRunner(input);
          if (loseStopResponse && input.args[0] === "stop" && input.args[1] === h.config.slots.green.unit) {
            loseStopResponse = false;
            caller.abort(new Error("caller timed out"));
            throw new Error("stop response lost after commit");
          }
          return result;
        },
        fetchImpl: h.fetchImpl,
        resolveServiceIdentity: h.resolveServiceIdentity,
      });
      await assert.rejects(
        runtime.withExclusiveLock(() => runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: caller.signal })),
        /stop response lost after commit/u,
      );
      assert.equal(h.serviceStates.get(h.config.slots.green.unit), true);
      const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
      assert.equal(state.slots.green.state, "running");
      assert.equal(state.recovery, null);
      assert.equal(h.commands.some((entry) => entry.endsWith("--property=ActiveState --value")), true);
      await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
    } finally {
      await h.cleanup();
    }
  });

  await t.test("restart response loss with service active commits running state", async () => {
    const h = await fixture();
    try {
      await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal }));
      h.commands.length = 0;
      let loseRestartResponse = true;
      const runtime = await createLinuxReleaseRuntime(h.config, {
        commandRunner: async (input) => {
          const result = await h.commandRunner(input);
          if (loseRestartResponse && input.args[0] === "restart") {
            loseRestartResponse = false;
            throw new Error("restart response lost after commit");
          }
          return result;
        },
        fetchImpl: h.fetchImpl,
        resolveServiceIdentity: h.resolveServiceIdentity,
      });
      await runtime.withExclusiveLock(() => runtime.startCandidate({ slot: "blue", artifact: h.nextArtifact, signal: AbortSignal.abort() }));
      assert.equal((await runtime.withExclusiveLock(() => runtime.status())).slots.blue.state, "running");
      assert.equal(h.serviceStates.get(h.config.slots.blue.unit), true);
    } finally {
      await h.cleanup();
    }
  });

  await t.test("compensating stop failure plus unknown query retains marker and lock", async () => {
    const h = await fixture();
    try {
      await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal }));
      h.commands.length = 0;
      let failState = true;
      const runtime = await createLinuxReleaseRuntime(h.config, {
        commandRunner: async (input) => {
          if (input.args[0] === "stop") throw new Error("compensating stop unknown");
          if (input.args[3] === "--property=ActiveState") throw new Error("active state query unknown");
          return h.commandRunner(input);
        },
        fetchImpl: h.fetchImpl,
        resolveServiceIdentity: h.resolveServiceIdentity,
        beforeAtomicWrite({ target }) {
          if (failState && target === h.config.stateFile) {
            failState = false;
            throw new Error("candidate state commit failed");
          }
        },
      });
      await assert.rejects(
        runtime.withExclusiveLock(() => runtime.startCandidate({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal })),
        (error) => error instanceof LinuxReleaseRuntimeError && error.code === "service_state_unknown",
      );
      assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
      const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
      assert.equal(state.recovery.kind, "service_state_unknown");
      assert.equal(state.recovery.operation, "compensating_stop");
    } finally {
      await h.cleanup();
    }
  });
});

test("abort-ignoring service and cleanup work returns by the hard deadline with immutable recovery state", async (t) => {
  async function preparedBlue(h) {
    await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal }));
    h.commands.length = 0;
  }

  await t.test("restart command and hanging termination handler", async () => {
    const h = await fixture();
    try {
      await preparedBlue(h);
      const runtime = await createLinuxReleaseRuntime({ ...h.config, timeoutMs: 100 }, {
        commandRunner: async ({ args, registerTermination }) => {
          if (args[0] === "restart") {
            registerTermination(() => new Promise(() => {}));
            return new Promise(() => {});
          }
          return h.commandRunner({ file: h.config.systemctlPath, args });
        },
        fetchImpl: h.fetchImpl,
        resolveServiceIdentity: h.resolveServiceIdentity,
      });
      const started = Date.now();
      await assert.rejects(
        runtime.withExclusiveLock(() => runtime.startCandidate({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal })),
        (error) => error instanceof LinuxReleaseRuntimeError && error.code === "service_state_unknown",
      );
      assert.equal(Date.now() - started < 1_000, true);
      assert.equal(JSON.parse(await readFile(h.config.stateFile, "utf8")).recovery.kind, "service_state_unknown");
      assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
    } finally {
      await h.cleanup();
    }
  });

  for (const operation of ["stop", "restart", "query"]) {
    await t.test(`${operation} late resolution cannot commit state or remove the release`, async () => {
      const h = await fixture();
      try {
        await preparedBlue(h);
        let resolveLate;
        const late = new Promise((resolve) => { resolveLate = resolve; });
        const commandRunner = async (input) => {
          if (operation === "query" && input.args[3] === "--property=ActiveState") return late;
          if (operation === "query" && input.args[0] === "restart") throw new Error("restart outcome unknown");
          if (operation !== "query" && input.args[0] === operation) return late;
          return h.commandRunner(input);
        };
        const runtime = await createLinuxReleaseRuntime({ ...h.config, timeoutMs: 100 }, { commandRunner, fetchImpl: h.fetchImpl, resolveServiceIdentity: h.resolveServiceIdentity });
        const action = operation === "stop"
          ? () => runtime.rejectCandidate({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal })
          : () => runtime.startCandidate({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal });
        await assert.rejects(
          runtime.withExclusiveLock(action),
          (error) => error instanceof LinuxReleaseRuntimeError && error.code === "service_state_unknown",
        );
        const frozen = await readFile(h.config.stateFile);
        resolveLate(operation === "query" ? { stdout: "inactive\n", stderr: "" } : { stdout: "", stderr: "" });
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.deepEqual(await readFile(h.config.stateFile), frozen);
        assert.equal(await readFile(path.join(h.config.slots.blue.releaseDir, "runtime", "app", "server.js"), "utf8"), 'console.log("next")\n');
        assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
      } finally {
        await h.cleanup();
      }
    });
  }

  await t.test("Caddy cleanup that ignores abort retains route recovery and returns", async () => {
    const h = await fixture();
    try {
      await h.seedActive(h.oldArtifact);
      await h.runtime.withExclusiveLock(async () => {
        await h.runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
        await h.runtime.startCandidate({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
      });
      let reloads = 0;
      const runtime = await createLinuxReleaseRuntime({ ...h.config, timeoutMs: 100 }, {
        commandRunner: async (input) => {
          if (input.args[0] === "reload" && ++reloads === 1) throw new Error("reload failed");
          if (input.args[0] === "reload") return new Promise(() => {});
          return h.commandRunner(input);
        },
        fetchImpl: h.fetchImpl,
        resolveServiceIdentity: h.resolveServiceIdentity,
      });
      const started = Date.now();
      await assert.rejects(
        runtime.withExclusiveLock(() => runtime.switchActive({
          expectedActiveSlot: "blue",
          expectedGeneration: 0,
          targetSlot: "green",
          artifact: h.nextArtifact,
          signal: new AbortController().signal,
        })),
        (error) => error instanceof LinuxReleaseRuntimeError && error.code === "timeout",
      );
      assert.equal(Date.now() - started < 1_000, true);
      assert.equal(JSON.parse(await readFile(h.config.stateFile, "utf8")).recovery.kind, "caddy_switch_unknown");
      assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
    } finally {
      await h.cleanup();
    }
  });
});

test("revoked operation leases block late prepare and Caddy namespace continuations", async (t) => {
  for (const kind of ["prepare", "caddy"]) {
    await t.test(kind, async () => {
      const h = await fixture();
      try {
        if (kind === "caddy") {
          await h.seedActive(h.oldArtifact);
          await h.runtime.withExclusiveLock(async () => {
            await h.runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
            await h.runtime.startCandidate({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
          });
        }
        let releaseLate;
        let markBlocked;
        const blocked = new Promise((resolve) => { markBlocked = resolve; });
        const late = new Promise((resolve) => { releaseLate = resolve; });
        let intercepted = false;
        const blockedTarget = kind === "prepare" ? h.config.stateFile : h.config.upstreamFile;
        const runtime = await createLinuxReleaseRuntime({ ...h.config, timeoutMs: 100 }, {
          commandRunner: h.commandRunner,
          fetchImpl: h.fetchImpl,
          async materializeArtifact({ artifact, destinationPath }) {
            const server = path.join(destinationPath, "runtime", "app", "server.js");
            await mkdir(path.dirname(server), { recursive: true });
            await writeFile(server, 'console.log("lease")\n');
            return artifact;
          },
          resolveServiceIdentity: h.resolveServiceIdentity,
          async beforeAtomicWrite(input) {
            if (!intercepted && input.target === blockedTarget) {
              intercepted = true;
              markBlocked();
              await late;
            }
          },
        });
        const operation = kind === "prepare"
          ? () => runtime.prepare({ slot: "blue", artifact: h.nextArtifact, signal: new AbortController().signal })
          : () => runtime.switchActive({
            expectedActiveSlot: "blue",
            expectedGeneration: 0,
            targetSlot: "green",
            artifact: h.nextArtifact,
            signal: new AbortController().signal,
          });
        let operationPromise;
        const locked = runtime.withExclusiveLock(async () => {
          operationPromise = operation();
          await Promise.race([
            blocked,
            operationPromise.then(() => {
              throw new Error("operation completed before the atomic-write interception");
            }),
          ]);
        });
        await assert.rejects(locked, (error) => error instanceof LinuxReleaseRuntimeError && error.code === "timeout");
        const frozenState = await readFile(h.config.stateFile).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
        const frozenUpstream = await readFile(h.config.upstreamFile).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error));
        const frozenRelease = await readdir(h.config.releaseRoot, { recursive: true });
        assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
        releaseLate();
        await new Promise((resolve) => setTimeout(resolve, 150));
        assert.deepEqual(await readFile(h.config.stateFile).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error)), frozenState);
        assert.deepEqual(await readFile(h.config.upstreamFile).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error)), frozenUpstream);
        assert.deepEqual(await readdir(h.config.releaseRoot, { recursive: true }), frozenRelease);
        assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
      } finally {
        await h.cleanup();
      }
    });
  }
});

test("prepare compensation rejects a late hardlink without mutating the external inode", async () => {
  const h = await fixture();
  const outside = path.join(path.dirname(h.config.releaseRoot), "late-compensation-alias.js");
  try {
    await h.runtime.withExclusiveLock(() => h.runtime.prepare({ slot: "green", artifact: h.oldArtifact, signal: new AbortController().signal }));
    let before;
    let bytesBefore;
    const runtime = await createLinuxReleaseRuntime(h.config, {
      commandRunner: h.commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      async beforeAtomicWrite({ target }) {
        if (target !== h.config.stateFile || before) return;
        const server = path.join(h.config.slots.green.releaseDir, "runtime", "app", "server.js");
        await link(server, outside);
        before = await stat(outside, { bigint: true });
        bytesBefore = await readFile(outside);
        throw new Error("state failure after late alias");
      },
    });
    await assert.rejects(
      runtime.withExclusiveLock(() => runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal })),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "compensation_failed",
    );
    const after = await stat(outside, { bigint: true });
    assert.deepEqual([after.dev, after.ino, after.mode, after.uid, after.gid], [before.dev, before.ino, before.mode, before.uid, before.gid]);
    assert.deepEqual(await readFile(outside), bytesBefore);
    assert.equal((await readFile(h.config.lockFile, "utf8")).length > 0, true);
  } finally {
    await rm(outside, { force: true });
    await h.cleanup();
  }
});

test("running candidate identity drift blocks slot activation before Caddy or state mutation", async () => {
  const h = await fixture();
  try {
    await h.seedActive(h.oldArtifact);
    let drift = false;
    const runtime = await createLinuxReleaseRuntime(h.config, {
      commandRunner: h.commandRunner,
      fetchImpl: h.fetchImpl,
      resolveServiceIdentity: h.resolveServiceIdentity,
      releaseFileSystem: {
        async lstat(target, options) {
          const value = await lstat(target, options);
          if (!drift || !target.endsWith(path.join("runtime", "app", "server.js"))) return value;
          return new Proxy(value, { get(object, property) { return property === "ino" ? object.ino + 1n : Reflect.get(object, property); } });
        },
      },
    });
    await runtime.withExclusiveLock(async () => {
      await runtime.prepare({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
      await runtime.startCandidate({ slot: "green", artifact: h.nextArtifact, signal: new AbortController().signal });
      h.commands.length = 0;
      drift = true;
      await assert.rejects(
        runtime.switchActive({
          expectedActiveSlot: "blue",
          expectedGeneration: 0,
          targetSlot: "green",
          artifact: h.nextArtifact,
          signal: new AbortController().signal,
        }),
        (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract",
      );
    });
    assert.deepEqual(h.commands, []);
    assert.equal(await readFile(h.config.upstreamFile, "utf8"), "reverse_proxy 127.0.0.1:31101\n");
    const state = JSON.parse(await readFile(h.config.stateFile, "utf8"));
    assert.equal(state.activeSlot, "blue");
    assert.equal(state.slots.green.state, "running");
  } finally {
    await h.cleanup();
  }
});

test("mocked POSIX namespace rejects service, supplementary-group, unrelated, and untrusted-owner mutation authority", async (t) => {
  for (const [name, override] of [
    ["baseline valid protected namespace", null],
    ["service-owned ancestor", { uid: 2_000n, gid: 2_000n, mode: 0o750n }],
    ["supplementary-group writable ancestor", { uid: 1_000n, gid: 3_000n, mode: 0o770n }],
    ["other-writable ancestor", { uid: 1_000n, gid: 1_000n, mode: 0o752n }],
    ["untrusted-owner ancestor", { uid: 4_000n, gid: 1_000n, mode: 0o750n }],
  ]) {
    await t.test(name, async () => {
      const h = await fixture();
      try {
        const vulnerableParent = path.resolve(path.dirname(h.config.stateFile));
        const releaseRoot = path.resolve(h.config.releaseRoot);
        const releaseFileSystem = {
          async lstat(target, options) {
            const value = await lstat(target, options);
            const resolved = path.resolve(target);
            const isRoot = resolved === path.parse(resolved).root;
            const isReleaseRoot = resolved === releaseRoot;
            const permissions = value.isDirectory() ? 0o755n : 0o555n;
            const identity = override !== null && resolved === vulnerableParent
              ? override
              : isRoot
                ? { uid: 0n, gid: 0n, mode: 0o755n }
                : isReleaseRoot
                  ? { uid: 1_000n, gid: 2_000n, mode: 0o750n }
                  : { uid: 1_000n, gid: 1_000n, mode: permissions };
            return new Proxy(value, {
              get(object, property) {
                if (property === "uid" || property === "gid") return identity[property];
                if (property === "mode") return (object.mode & ~0o777n) | identity.mode;
                return Reflect.get(object, property);
              },
            });
          },
        };
        const runtime = await createLinuxReleaseRuntime(h.config, {
          commandRunner: h.commandRunner,
          deployIdentity: { uid: 1_000n, gid: 1_000n, user: "deploy" },
          fetchImpl: h.fetchImpl,
          releaseFileSystem,
          resolveServiceIdentity: async () => ({ uid: 2_000n, gid: 2_000n, groups: [2_000n, 3_000n] }),
        });
        if (override === null) await runtime.withExclusiveLock(() => Promise.resolve());
        else {
          await assert.rejects(
            runtime.withExclusiveLock(() => Promise.resolve()),
            (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract" && /namespace/u.test(error.message),
          );
        }
        assert.deepEqual(h.commands, []);
        await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
      } finally {
        await h.cleanup();
      }
    });
  }
});

test("sticky sharing is allowed only above exact protected mutable parents", async (t) => {
  for (const targetKind of ["safe ancestor", "release root", "slot root", "state parent", "upstream parent", "executable parent", "trusted-input parent", "artifact parent"]) {
    await t.test(targetKind, async () => {
      const h = await fixture();
      try {
        let config = h.config;
        let artifact = h.nextArtifact;
        const fixtureRoot = path.dirname(h.config.releaseRoot);
        let vulnerable;
        if (targetKind === "safe ancestor") vulnerable = path.resolve(path.dirname(fixtureRoot));
        if (targetKind === "release root") vulnerable = path.resolve(h.config.releaseRoot);
        if (targetKind === "slot root") {
          vulnerable = path.resolve(h.config.slots.blue.releaseDir);
          await mkdir(vulnerable);
        }
        if (targetKind === "state parent") vulnerable = path.resolve(path.dirname(h.config.stateFile));
        if (targetKind === "upstream parent") vulnerable = path.resolve(path.dirname(h.config.upstreamFile));
        if (targetKind === "executable parent") vulnerable = path.resolve(path.dirname(h.config.systemctlPath));
        if (targetKind === "trusted-input parent") {
          const trustedRoot = path.join(fixtureRoot, "isolated-trusted");
          await mkdir(trustedRoot);
          const runtimeEnvFile = path.join(trustedRoot, "runtime.env");
          const trustedBuilderPublicKeyPath = path.join(trustedRoot, "builder.pem");
          await copyFile(h.config.runtimeEnvFile, runtimeEnvFile);
          await copyFile(h.config.trustedBuilderPublicKeyPath, trustedBuilderPublicKeyPath);
          config = { ...config, runtimeEnvFile, trustedBuilderPublicKeyPath };
          vulnerable = path.resolve(trustedRoot);
        }
        if (targetKind === "artifact parent") {
          const artifactRoot = path.join(fixtureRoot, "isolated-artifact");
          await mkdir(artifactRoot);
          const archivePath = path.join(artifactRoot, "next.tar");
          const manifestPath = path.join(artifactRoot, "next.manifest.json");
          await copyFile(h.nextArtifact.archivePath, archivePath);
          await copyFile(h.nextArtifact.manifestPath, manifestPath);
          artifact = { ...h.nextArtifact, archivePath, manifestPath };
          vulnerable = path.resolve(artifactRoot);
        }
        const releaseRoot = path.resolve(config.releaseRoot);
        const releaseFileSystem = {
          async lstat(target, options) {
            const value = await lstat(target, options);
            const resolved = path.resolve(target);
            const isRoot = resolved === path.parse(resolved).root;
            const isReleaseRoot = resolved === releaseRoot;
            const isVulnerable = resolved === vulnerable;
            const identity = isVulnerable
              ? { uid: targetKind === "safe ancestor" ? 0n : 1_000n, gid: targetKind === "safe ancestor" ? 0n : 3_000n, mode: targetKind === "safe ancestor" ? 0o1777n : 0o1770n }
              : isRoot
                ? { uid: 0n, gid: 0n, mode: 0o755n }
                : isReleaseRoot
                  ? { uid: 1_000n, gid: 2_000n, mode: 0o750n }
                  : { uid: 1_000n, gid: 1_000n, mode: value.isDirectory() ? 0o755n : 0o555n };
            return new Proxy(value, {
              get(object, property) {
                if (property === "uid" || property === "gid") return identity[property];
                if (property === "mode") return (object.mode & ~0o7777n) | identity.mode;
                return Reflect.get(object, property);
              },
            });
          },
        };
        const runtime = await createLinuxReleaseRuntime(config, {
          commandRunner: h.commandRunner,
          deployIdentity: { uid: 1_000n, gid: 1_000n, user: "deploy" },
          fetchImpl: h.fetchImpl,
          releaseFileSystem,
          resolveServiceIdentity: async () => ({ uid: 2_000n, gid: 2_000n, groups: [2_000n, 3_000n] }),
        });
        if (targetKind === "safe ancestor") {
          await runtime.withExclusiveLock(() => Promise.resolve());
        } else {
          await assert.rejects(
            runtime.withExclusiveLock(() => targetKind === "artifact parent"
              ? runtime.prepare({ slot: "blue", artifact, signal: new AbortController().signal })
              : Promise.resolve()),
            (error) => error instanceof LinuxReleaseRuntimeError
              && error.code === "host_contract"
              && /namespace/u.test(error.message),
          );
        }
        assert.deepEqual(h.commands, []);
        await assert.rejects(() => readFile(config.lockFile), { code: "ENOENT" });
      } finally {
        await h.cleanup();
      }
    });
  }
});

const nativeServiceUser = process.env.MOAWORK_NATIVE_RELEASE_SERVICE_USER ?? "";
const nativeUnrelatedUser = process.env.MOAWORK_NATIVE_RELEASE_UNRELATED_USER ?? "";
const nativeSetprivPath = process.env.MOAWORK_NATIVE_SETPRIV_PATH ?? "";
const nativeOwnershipSkip = process.platform !== "linux"
  ? "native ownership probe is Linux-only"
  : process.getuid() !== 0 || nativeServiceUser === "" || nativeUnrelatedUser === "" || nativeSetprivPath === ""
    ? "set MOAWORK_NATIVE_RELEASE_SERVICE_USER, MOAWORK_NATIVE_RELEASE_UNRELATED_USER, and MOAWORK_NATIVE_SETPRIV_PATH under a protected root Linux runner"
    : false;

test("native Linux release is deploy-owned, service-readable, service-write-denied, and unrelated-read-denied", { skip: nativeOwnershipSkip }, async () => {
  const h = await fixture();
  try {
    const serviceUid = Number(execFileSync("/usr/bin/id", ["-u", nativeServiceUser], { encoding: "utf8" }).trim());
    const serviceGid = Number(execFileSync("/usr/bin/id", ["-g", nativeServiceUser], { encoding: "utf8" }).trim());
    const unrelatedUid = Number(execFileSync("/usr/bin/id", ["-u", nativeUnrelatedUser], { encoding: "utf8" }).trim());
    const unrelatedGid = Number(execFileSync("/usr/bin/id", ["-g", nativeUnrelatedUser], { encoding: "utf8" }).trim());
    assert.notEqual(serviceUid, process.getuid());
    assert.notEqual(unrelatedUid, serviceUid);
    assert.notEqual(unrelatedGid, serviceGid, "protected probe requires distinct service and unrelated primary groups");
    h.config.serviceUser = nativeServiceUser;
    const wrongGroupParent = path.join(path.dirname(h.config.releaseRoot), "wrong-group-parent");
    const isolatedReleaseRoot = path.join(wrongGroupParent, "releases");
    await mkdir(isolatedReleaseRoot, { recursive: true });
    await chown(wrongGroupParent, process.getuid(), unrelatedGid);
    await chmod(wrongGroupParent, 0o750);
    await chown(isolatedReleaseRoot, process.getuid(), serviceGid);
    await chmod(isolatedReleaseRoot, 0o750);
    const wrongGroupConfig = {
      ...h.config,
      releaseRoot: isolatedReleaseRoot,
      slots: Object.fromEntries(Object.entries(h.config.slots).map(([slot, value]) => [slot, { ...value, releaseDir: path.join(isolatedReleaseRoot, slot) }])),
    };
    const wrongGroupRuntime = await createLinuxReleaseRuntime(wrongGroupConfig, { commandRunner: h.commandRunner, fetchImpl: h.fetchImpl });
    await assert.rejects(
      wrongGroupRuntime.withExclusiveLock(() => Promise.resolve()),
      (error) => error instanceof LinuxReleaseRuntimeError && error.code === "host_contract" && /traversable/u.test(error.message),
    );
    assert.deepEqual(h.commands, []);
    await chown(h.config.releaseRoot, process.getuid(), serviceGid);
    await chmod(h.config.releaseRoot, 0o750);
    const runtime = await createLinuxReleaseRuntime(h.config, { commandRunner: h.commandRunner, fetchImpl: h.fetchImpl });
    const controller = await createProductionReleaseSlots({ runtime, slotIds: h.config.slotIds, timeoutMs: h.config.timeoutMs, trustedBuilderPublicKeyPath: h.config.trustedBuilderPublicKeyPath });
    await runtime.withExclusiveLock(() => controller.deploy({
      mode: "shadow",
      archivePath: h.nextArtifact.archivePath,
      manifestPath: h.nextArtifact.manifestPath,
      attestationPath: h.nextAttestationPath,
      expectedSourceSha: h.nextArtifact.sourceSha,
    }));
    const releaseDir = h.config.slots.blue.releaseDir;
    const serverPath = path.join(releaseDir, "runtime", "app", "server.js");
    const rootStats = await stat(releaseDir, { bigint: true });
    const fileStats = await stat(serverPath, { bigint: true });
    assert.equal(rootStats.uid, BigInt(process.getuid()));
    assert.equal(rootStats.gid, BigInt(serviceGid));
    assert.equal(rootStats.mode & 0o777n, 0o550n);
    assert.equal(fileStats.uid, BigInt(process.getuid()));
    assert.equal(fileStats.gid, BigInt(serviceGid));
    assert.equal(fileStats.mode & 0o777n, 0o440n);
    const serviceProbe = spawnSync(nativeSetprivPath, [
      "--reuid", String(serviceUid), "--regid", String(serviceGid), "--clear-groups",
      process.execPath, "-e",
      "const fs=require('node:fs');const p=process.argv[1];fs.readFileSync(p);try{fs.appendFileSync(p,'x');process.exit(9)}catch(e){process.exit(['EACCES','EPERM','EROFS'].includes(e.code)?0:8)}",
      serverPath,
    ]);
    assert.equal(serviceProbe.status, 0, serviceProbe.stderr?.toString("utf8"));
    const unrelatedProbe = spawnSync(nativeSetprivPath, [
      "--reuid", String(unrelatedUid), "--regid", String(unrelatedGid), "--clear-groups",
      process.execPath, "-e",
      "const fs=require('node:fs');try{fs.readFileSync(process.argv[1]);process.exit(9)}catch(e){process.exit(['EACCES','EPERM'].includes(e.code)?0:8)}",
      serverPath,
    ]);
    assert.equal(unrelatedProbe.status, 0, unrelatedProbe.stderr?.toString("utf8"));
  } finally {
    await h.cleanup();
  }
});

test("CLI verifies the signed builder tuple before acquiring the runtime lock", async () => {
  const h = await fixture();
  try {
    const configPath = path.join(path.dirname(h.config.stateFile), "wrong-builder-release-config.json");
    await writeFile(configPath, `${JSON.stringify({ ...h.config, nodeArch: "arm64" }, null, 2)}\n`);
    await assert.rejects(
      runReleaseCli([
        "deploy", "--config", configPath,
        "--mode", "shadow",
        "--archive", h.nextArtifact.archivePath,
        "--manifest", h.nextArtifact.manifestPath,
        "--attestation", h.nextAttestationPath,
        "--source-sha", h.nextArtifact.sourceSha,
      ], { runtimeDependencies: { commandRunner: h.commandRunner, fetchImpl: h.fetchImpl, resolveServiceIdentity: h.resolveServiceIdentity } }),
      (error) => error?.code === "artifact_untrusted",
    );
    assert.deepEqual(h.commands, []);
    await assert.rejects(() => readFile(h.config.lockFile), { code: "ENOENT" });
  } finally {
    await h.cleanup();
  }
});

test("CLI status binds config and production verifier while an empty activation stays impossible", async () => {
  const h = await fixture();
  try {
    const help = await runReleaseCli(["help"]);
    assert.match(help.help, /first-cutover-prepare[^\n]* \\\n    --slot/u);
    assert.match(help.help, /first-cutover-confirm[^\n]* \\\n    --slot/u);
    assert.match(help.help, /first-cutover-abort[^\n]* \\\n    --slot/u);
    const configPath = path.join(path.dirname(h.config.stateFile), "release-config.json");
    await writeFile(configPath, `${JSON.stringify(h.config, null, 2)}\n`);
    const status = await runReleaseCli(["status", "--config", configPath], {
      runtimeDependencies: {
        commandRunner: async (input) => h.commands.push(`${path.basename(input.file)} ${input.args.join(" ")}`),
        fetchImpl: async () => new Response("{}", { status: 503 }),
        resolveServiceIdentity: h.resolveServiceIdentity,
      },
    });
    assert.equal(status.activeSlot, null);
    await assert.rejects(
      runReleaseCli(["status", "--config", "relative-config.json"]),
      /config path must be absolute/u,
    );
    await assert.rejects(
      runReleaseCli([
        "deploy", "--config", configPath,
        "--mode", "activate",
        "--archive", h.nextArtifact.archivePath,
        "--manifest", h.nextArtifact.manifestPath,
        "--attestation", h.nextAttestationPath,
        "--source-sha", h.nextArtifact.sourceSha,
      ], {
        runtimeDependencies: {
          commandRunner: async (input) => h.commands.push(`${path.basename(input.file)} ${input.args.join(" ")}`),
          fetchImpl: async () => new Response("{}", { status: 503 }),
          resolveServiceIdentity: h.resolveServiceIdentity,
        },
      }),
      (error) => error?.code === "rollback_unavailable",
    );
    assert.deepEqual(h.commands, []);
  } finally {
    await h.cleanup();
  }
});
