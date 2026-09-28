import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { packReleaseArtifact, verifyReleaseArtifact } from "./contract.mjs";
import { releaseProvenanceStatement, verifyTrustedReleaseArtifact } from "./provenance.mjs";

const CLI = path.resolve(import.meta.dirname, "artifact.mjs");
const SERVER_ACTIONS_KEY = Buffer.alloc(32, 7).toString("base64");
const SERVER_ACTIONS_KEY_FINGERPRINT = createHmac("sha256", Buffer.from(SERVER_ACTIONS_KEY, "base64"))
  .update("moawork:server-actions:fingerprint:v1")
  .digest("hex");

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "moawork-artifact-"));
  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, ".build", "standalone", "app"), { recursive: true });
  await mkdir(path.join(repo, ".build", "standalone", "app", ".next", "server"), { recursive: true });
  await mkdir(path.join(repo, ".build", "static"), { recursive: true });
  await mkdir(path.join(repo, "public"), { recursive: true });
  await writeFile(path.join(repo, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(path.join(repo, "tracked.txt"), "source\n");
  await writeFile(path.join(repo, ".build", "standalone", "app", "server.js"), 'console.log("web")\n');
  await writeFile(path.join(repo, ".build", "standalone", "package.json"), '{"type":"commonjs"}\n');
  await writeFile(
    path.join(repo, ".build", "standalone", "app", ".next", "server", "server-reference-manifest.json"),
    `${JSON.stringify({ encryptionKey: SERVER_ACTIONS_KEY, node: {}, edge: {}, encryptionKeyHash: "fixture" })}\n`,
  );
  await writeFile(path.join(repo, ".build", "static", "chunk.js"), "self.chunk=1\n");
  await writeFile(path.join(repo, "public", "icon.svg"), "<svg/>\n");
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "artifact@example.invalid"]);
  git(repo, ["config", "user.name", "Artifact Fixture"]);
  git(repo, ["add", "package-lock.json", "tracked.txt"]);
  git(repo, ["commit", "-m", "fixture"]);
  await mkdir(path.join(repo, ".build", "standalone", "app", ".next"), { recursive: true });
  await writeFile(
    path.join(repo, ".build", "standalone", "app", ".next", "required-server-files.json"),
    `${JSON.stringify({ config: { deploymentId: git(repo, ["rev-parse", "HEAD"]), env: { MOAWORK_SERVER_ACTIONS_BUILD_FINGERPRINT: SERVER_ACTIONS_KEY_FINGERPRINT } } })}\n`,
  );
  return {
    root,
    repo,
    standalone: path.join(repo, ".build", "standalone"),
    staticRoot: path.join(repo, ".build", "static"),
    publicRoot: path.join(repo, "public"),
    archive: path.join(root, "release.tar"),
    manifest: path.join(root, "release.manifest.json"),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeField(buffer, offset, length, value) {
  Buffer.from(value).copy(buffer, offset, 0, length);
}

function writeOctal(buffer, offset, length, value) {
  writeField(buffer, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

function hostileTarEntry(name, { type = "0", content = Buffer.alloc(0) } = {}) {
  const header = Buffer.alloc(512);
  writeField(header, 0, 100, name);
  writeOctal(header, 100, 8, type === "5" ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  writeField(header, 257, 6, "ustar\0");
  writeField(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeField(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

function hostileTar(entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

function rewriteHeaderChecksum(archiveBytes, headerOffset = 0) {
  archiveBytes.fill(0x20, headerOffset + 148, headerOffset + 156);
  const checksum = archiveBytes.subarray(headerOffset, headerOffset + 512).reduce((sum, byte) => sum + byte, 0);
  archiveBytes.fill(0, headerOffset + 148, headerOffset + 156);
  writeField(archiveBytes, headerOffset + 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
}

async function manifestForArchive(fixtureState, archiveBytes, entries) {
  const manifest = JSON.parse(await readFile(fixtureState.manifest, "utf8"));
  manifest.archive.file = path.basename(fixtureState.archive);
  manifest.archive.bytes = archiveBytes.length;
  manifest.archive.sha256 = sha256(archiveBytes);
  manifest.payload.entries = entries;
  manifest.payload.entryCount = entries.length;
  manifest.payload.entriesSha256 = sha256(`${JSON.stringify(entries, null, 2)}\n`);
  await writeFile(fixtureState.archive, archiveBytes);
  await writeFile(fixtureState.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function clean(state) {
  await rm(state.root, { recursive: true, force: true });
}

test("CLI packs a deterministic standalone archive and verifies before atomic extraction", async () => {
  const state = await fixture();
  try {
    const packed = spawnSync(process.execPath, [CLI, "pack", "--repo", state.repo, "--standalone", state.standalone, "--static", state.staticRoot, "--public", state.publicRoot, "--archive", state.archive, "--manifest", state.manifest], { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    const descriptor = JSON.parse(packed.stdout);
    assert.equal(descriptor.sourceSha, git(state.repo, ["rev-parse", "HEAD"]));
    assert.equal(descriptor.sourceTree, git(state.repo, ["show", "-s", "--format=%T", "HEAD"]));
    assert.match(descriptor.archiveSha256, /^[0-9a-f]{64}$/);
    assert.equal(descriptor.releaseId, descriptor.archiveSha256);
    assert.equal(descriptor.serverActionsKeyFingerprint, SERVER_ACTIONS_KEY_FINGERPRINT);
    assert.deepEqual(descriptor.services, [{ serviceKey: "web", payloadRoot: "runtime" }]);

    const manifest = JSON.parse(await readFile(state.manifest, "utf8"));
    assert.equal(manifest.source.lockSha256, sha256(await readFile(path.join(state.repo, "package-lock.json"))));
    assert.deepEqual(manifest.build, { serverActionsKeyFingerprint: SERVER_ACTIONS_KEY_FINGERPRINT });
    assert.deepEqual(manifest.assurance, {
      transportIntegrityOnly: true,
      signed: false,
      builderTrustVerified: false,
      linuxAbiVerified: false,
    });
    const duplicateOutput = path.join(state.root, "duplicate-output");
    await mkdir(duplicateOutput);
    const secondArchive = path.join(duplicateOutput, "release.tar");
    const secondManifest = path.join(duplicateOutput, "release.manifest.json");
    await packReleaseArtifact({
      repoPath: state.repo,
      standalonePath: state.standalone,
      staticPath: state.staticRoot,
      publicPath: state.publicRoot,
      archivePath: secondArchive,
      manifestPath: secondManifest,
    });
    assert.deepEqual(await readFile(secondArchive), await readFile(state.archive));
    assert.deepEqual(await readFile(secondManifest), await readFile(state.manifest));
    const destination = path.join(state.root, "verified-release");
    const verified = spawnSync(process.execPath, [CLI, "verify", "--archive", state.archive, "--manifest", state.manifest, "--destination", destination], { encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).archiveSha256, descriptor.archiveSha256);
    assert.equal(await readFile(path.join(destination, "runtime", "app", "server.js"), "utf8"), 'console.log("web")\n');
    assert.equal(await readFile(path.join(destination, "runtime", "app", ".next", "static", "chunk.js"), "utf8"), "self.chunk=1\n");
    assert.equal(await readFile(path.join(destination, "runtime", "app", "public", "icon.svg"), "utf8"), "<svg/>\n");
  } finally {
    await clean(state);
  }
});

test("packing rejects env files, secret-shaped content, duplicate mappings, and out-of-root junctions", async (t) => {
  await t.test("environment filename", async () => {
    const state = await fixture();
    try {
      await writeFile(path.join(state.standalone, ".env.production"), "VALUE=redacted\n");
      await assert.rejects(() => packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest }), { code: "RUNTIME_SECRET_FILE" });
      await assert.rejects(() => readFile(state.archive), { code: "ENOENT" });
      await assert.rejects(() => readFile(state.manifest), { code: "ENOENT" });
    } finally { await clean(state); }
  });

  await t.test("secret-shaped content", async () => {
    const state = await fixture();
    try {
      await writeFile(path.join(state.standalone, "config.txt"), "DATABASE_URL=not-a-real-value\n");
      await assert.rejects(() => packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest }), { code: "RUNTIME_SECRET_CONTENT" });
    } finally { await clean(state); }
  });

  await t.test("credential-shaped JSON key", async () => {
    const state = await fixture();
    try {
      await writeFile(path.join(state.standalone, "runtime-config.json"), '{"client_secret":"not-a-real-secret"}\n');
      await assert.rejects(() => packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest }), { code: "RUNTIME_SECRET_CONTENT" });
    } finally { await clean(state); }
  });

  await t.test("duplicate mapped entry", async () => {
    const state = await fixture();
    try {
      await mkdir(path.join(state.standalone, "app", ".next", "static"), { recursive: true });
      await writeFile(path.join(state.standalone, "app", ".next", "static", "chunk.js"), "duplicate\n");
      await assert.rejects(() => packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest }), { code: "DUPLICATE_ENTRY" });
    } finally { await clean(state); }
  });

  await t.test("junction outside source", async (context) => {
    const state = await fixture();
    try {
      const outside = path.join(state.root, "outside");
      await mkdir(outside);
      await writeFile(path.join(outside, "file.txt"), "outside\n");
      try {
        await symlink(outside, path.join(state.standalone, "outside-link"), process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (error?.code === "EPERM") return context.skip("host cannot create a fixture symlink");
        throw error;
      }
      await assert.rejects(() => packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest }), { code: "SYMLINK_OUTSIDE_ROOT" });
    } finally { await clean(state); }
  });

  await t.test("internal directory link is safely dereferenced", async (context) => {
    const state = await fixture();
    try {
      try {
        await symlink(path.join(state.standalone, "app"), path.join(state.standalone, "app-copy"), process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (error?.code === "EPERM") return context.skip("host cannot create a fixture symlink");
        throw error;
      }
      await packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest });
      const manifest = JSON.parse(await readFile(state.manifest, "utf8"));
      assert.equal(manifest.payload.entries.some((entry) => entry.path === "runtime/app-copy/server.js" && entry.type === "file"), true);
    } finally { await clean(state); }
  });

  await t.test("in-root link target with a dot-dot prefix is not a parent traversal", async (context) => {
    const state = await fixture();
    try {
      const target = path.join(state.standalone, "..target");
      await mkdir(target);
      await writeFile(path.join(target, "safe.txt"), "safe\n");
      try {
        await symlink(target, path.join(state.standalone, "dot-target-copy"), process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (error?.code === "EPERM") return context.skip("host cannot create a fixture symlink");
        throw error;
      }
      await packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest });
      const manifest = JSON.parse(await readFile(state.manifest, "utf8"));
      assert.equal(manifest.payload.entries.some((entry) => entry.path === "runtime/dot-target-copy/safe.txt"), true);
    } finally { await clean(state); }
  });
});

test("verification fails closed before destination or activation state changes", async () => {
  const state = await fixture();
  try {
    await packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest });
    const activation = path.join(state.root, "active-release");
    const destination = path.join(state.root, "candidate-release");
    await writeFile(activation, "previous-release\n");
    const archive = await readFile(state.archive);
    archive[600] ^= 0xff;
    await writeFile(state.archive, archive);
    await assert.rejects(() => verifyReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest, destinationPath: destination }), { code: "ARCHIVE_DIGEST" });
    await assert.rejects(() => readFile(destination), { code: "ENOENT" });
    assert.equal(await readFile(activation, "utf8"), "previous-release\n");
  } finally { await clean(state); }
});

test("verifier rejects traversal, absolute, symlink, and duplicate tar entries", async (t) => {
  async function run(name, entries, manifestEntries, code) {
    await t.test(name, async () => {
      const state = await fixture();
      try {
        await packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest });
        const bytes = hostileTar(entries);
        await manifestForArchive(state, bytes, manifestEntries);
        const destination = path.join(state.root, "rejected-release");
        await assert.rejects(() => verifyReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest, destinationPath: destination }), { code });
        await assert.rejects(() => readFile(destination), { code: "ENOENT" });
      } finally { await clean(state); }
    });
  }

  const file = (entryPath, content = "x") => ({ path: entryPath, type: "file", mode: 0o644, size: Buffer.byteLength(content), sha256: sha256(content) });
  await run("traversal", [hostileTarEntry("../escape", { content: Buffer.from("x") })], [file("../escape")], "UNSAFE_ARCHIVE_PATH");
  await run("absolute path", [hostileTarEntry("/absolute", { content: Buffer.from("x") })], [file("/absolute")], "UNSAFE_ARCHIVE_PATH");
  await run("symlink type", [hostileTarEntry("runtime/app/server.js", { type: "2" })], [file("runtime/app/server.js", "")], "TAR_ENTRY_TYPE");
  await run("duplicate path", [hostileTarEntry("runtime/app/server.js", { content: Buffer.from("x") }), hostileTarEntry("runtime/app/server.js", { content: Buffer.from("x") })], [file("runtime/app/server.js")], "DUPLICATE_ENTRY");

  await t.test("noncanonical bytes after a tar name terminator", async () => {
    const state = await fixture();
    try {
      await packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest });
      const bytes = await readFile(state.archive);
      bytes[100 - 1] = 0x58;
      rewriteHeaderChecksum(bytes);
      const manifest = JSON.parse(await readFile(state.manifest, "utf8"));
      manifest.archive.sha256 = sha256(bytes);
      await writeFile(state.archive, bytes);
      await writeFile(state.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
      const destination = path.join(state.root, "rejected-release");
      await assert.rejects(() => verifyReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest, destinationPath: destination }), { code: "TAR_HEADER_CANONICAL" });
      await assert.rejects(() => readFile(destination), { code: "ENOENT" });
    } finally { await clean(state); }
  });
});

test("manifest cannot overclaim signing, trusted builder, or Linux ABI proof", async () => {
  const state = await fixture();
  try {
    await packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest });
    const manifest = JSON.parse(await readFile(state.manifest, "utf8"));
    manifest.assurance.signed = true;
    await writeFile(state.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    await assert.rejects(() => verifyReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest }), { code: "ASSURANCE_OVERCLAIM" });
  } finally { await clean(state); }
});

function syntheticLinuxRuntimeEvidence(descriptor) {
  return {
    kind: "next-standalone-http-health-v1",
    platform: "linux",
    arch: descriptor.builder.arch,
    nodeVersion: descriptor.builder.nodeVersion,
    healthPath: "/api/health/live",
    sourceSha: descriptor.sourceSha,
    archiveSha256: descriptor.archiveSha256,
    serverActionsKeyFingerprint: descriptor.serverActionsKeyFingerprint,
  };
}

function syntheticProtectedCiEvidence(descriptor) {
  return {
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
  };
}

// These fixtures exercise offline statement/signature verification only. They
// are not native-execution evidence: the production private key is trusted to
// be available only to signReleaseArtifactAttestation in the protected Linux
// job, where the executable smoke runs before the signature is created.
async function writeTestAttestation({ descriptor, privateKey, publicKey, target, statement = releaseProvenanceStatement(descriptor, syntheticLinuxRuntimeEvidence(descriptor), syntheticProtectedCiEvidence(descriptor)) }) {
  const statementBytes = Buffer.from(`${JSON.stringify(statement, null, 2)}\n`);
  const keyId = sha256(publicKey.export({ type: "spki", format: "der" }));
  const attestation = {
    schema: 1,
    statement,
    signature: {
      algorithm: "ed25519",
      keyId,
      value: sign(null, statementBytes, privateKey).toString("base64"),
    },
  };
  await writeFile(target, `${JSON.stringify(attestation, null, 2)}\n`);
}

test("pinned Ed25519 provenance requires exact protected-CI and native-runtime claims", async () => {
  const state = await fixture();
  try {
    await packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest });
    const manifest = JSON.parse(await readFile(state.manifest, "utf8"));
    manifest.builder.platform = "linux";
    manifest.builder.arch = "x64";
    await writeFile(state.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    const descriptor = await verifyReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest });
    const trusted = generateKeyPairSync("ed25519");
    const attacker = generateKeyPairSync("ed25519");
    const publicKeyPath = path.join(state.root, "builder.pub.pem");
    const attestationPath = path.join(state.root, "release.attestation.json");
    await writeFile(publicKeyPath, trusted.publicKey.export({ type: "spki", format: "pem" }));
    await writeTestAttestation({ descriptor, privateKey: trusted.privateKey, publicKey: trusted.publicKey, target: attestationPath });

    const verified = await verifyTrustedReleaseArtifact({
      archivePath: state.archive,
      manifestPath: state.manifest,
      attestationPath,
      trustedPublicKeyPath: publicKeyPath,
    });
    assert.deepEqual(verified.assurance, {
      transportIntegrityOnly: false,
      signed: true,
      builderTrustVerified: true,
      linuxAbiVerified: true,
    });

    const attackerPath = path.join(state.root, "attacker.attestation.json");
    await writeTestAttestation({ descriptor, privateKey: attacker.privateKey, publicKey: attacker.publicKey, target: attackerPath });
    await assert.rejects(
      () => verifyTrustedReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest, attestationPath: attackerPath, trustedPublicKeyPath: publicKeyPath }),
      { code: "PROVENANCE_KEY" },
    );
    await assert.rejects(
      () => verifyTrustedReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest, attestationPath, trustedPublicKeyPath: path.join(state.root, "missing.pub.pem") }),
      { code: "PROVENANCE_KEY" },
    );

    const tamperedSignaturePath = path.join(state.root, "tampered-signature.attestation.json");
    const tamperedSignature = JSON.parse(await readFile(attestationPath, "utf8"));
    tamperedSignature.signature.value = `${tamperedSignature.signature.value.slice(0, -4)}AAAA`;
    await writeFile(tamperedSignaturePath, `${JSON.stringify(tamperedSignature, null, 2)}\n`);
    await assert.rejects(
      () => verifyTrustedReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest, attestationPath: tamperedSignaturePath, trustedPublicKeyPath: publicKeyPath }),
      { code: "PROVENANCE_SIGNATURE" },
    );

    const wrongSubjectPath = path.join(state.root, "wrong-subject.attestation.json");
    const wrongStatement = releaseProvenanceStatement(descriptor, syntheticLinuxRuntimeEvidence(descriptor), syntheticProtectedCiEvidence(descriptor));
    wrongStatement.subject.sourceTree = "f".repeat(40);
    await writeTestAttestation({ descriptor, privateKey: trusted.privateKey, publicKey: trusted.publicKey, target: wrongSubjectPath, statement: wrongStatement });
    await assert.rejects(
      () => verifyTrustedReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest, attestationPath: wrongSubjectPath, trustedPublicKeyPath: publicKeyPath }),
      { code: "PROVENANCE_SUBJECT" },
    );

    const wrongRuntimePath = path.join(state.root, "wrong-runtime.attestation.json");
    const wrongRuntimeStatement = releaseProvenanceStatement(descriptor, {
      ...syntheticLinuxRuntimeEvidence(descriptor),
      serverActionsKeyFingerprint: "0".repeat(64),
    }, syntheticProtectedCiEvidence(descriptor));
    await writeTestAttestation({ descriptor, privateKey: trusted.privateKey, publicKey: trusted.publicKey, target: wrongRuntimePath, statement: wrongRuntimeStatement });
    await assert.rejects(
      () => verifyTrustedReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest, attestationPath: wrongRuntimePath, trustedPublicKeyPath: publicKeyPath }),
      { code: "PROVENANCE_RUNTIME" },
    );

    const missingCiPath = path.join(state.root, "missing-ci.attestation.json");
    await writeTestAttestation({
      descriptor,
      privateKey: trusted.privateKey,
      publicKey: trusted.publicKey,
      target: missingCiPath,
      statement: releaseProvenanceStatement(descriptor, syntheticLinuxRuntimeEvidence(descriptor), {}),
    });
    await assert.rejects(
      () => verifyTrustedReleaseArtifact({ archivePath: state.archive, manifestPath: state.manifest, attestationPath: missingCiPath, trustedPublicKeyPath: publicKeyPath }),
      { code: "PROVENANCE_CI" },
    );

    const windowsManifest = { ...manifest, builder: { ...manifest.builder, platform: "win32" } };
    const windowsManifestPath = path.join(state.root, "windows.manifest.json");
    await writeFile(windowsManifestPath, `${JSON.stringify(windowsManifest, null, 2)}\n`);
    const windowsDescriptor = await verifyReleaseArtifact({ archivePath: state.archive, manifestPath: windowsManifestPath });
    const windowsAttestationPath = path.join(state.root, "windows.attestation.json");
    await writeTestAttestation({ descriptor: windowsDescriptor, privateKey: trusted.privateKey, publicKey: trusted.publicKey, target: windowsAttestationPath });
    await assert.rejects(
      () => verifyTrustedReleaseArtifact({ archivePath: state.archive, manifestPath: windowsManifestPath, attestationPath: windowsAttestationPath, trustedPublicKeyPath: publicKeyPath }),
      { code: "BUILDER_PLATFORM" },
    );
  } finally { await clean(state); }
});

test("pack rejects stale standalone deployment identity before creating outputs", async () => {
  const state = await fixture();
  try {
    await writeFile(
      path.join(state.standalone, "app", ".next", "required-server-files.json"),
      `${JSON.stringify({ config: { deploymentId: "0".repeat(40) } })}\n`,
    );
    await assert.rejects(
      () => packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest }),
      { code: "BUILD_IDENTITY_MISMATCH" },
    );
    await assert.rejects(() => readFile(state.archive), { code: "ENOENT" });
    await assert.rejects(() => readFile(state.manifest), { code: "ENOENT" });
  } finally { await clean(state); }
});

test("pack rejects a standalone build without an exact Server Actions fingerprint", async () => {
  const state = await fixture();
  try {
    await writeFile(
      path.join(state.standalone, "app", ".next", "required-server-files.json"),
      `${JSON.stringify({ config: { deploymentId: git(state.repo, ["rev-parse", "HEAD"]), env: {} } })}\n`,
    );
    await assert.rejects(
      () => packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest }),
      { code: "SERVER_ACTIONS_BUILD_FINGERPRINT" },
    );
    await assert.rejects(() => readFile(state.archive), { code: "ENOENT" });
    await assert.rejects(() => readFile(state.manifest), { code: "ENOENT" });
  } finally { await clean(state); }
});

test("pack rejects a fingerprint that does not match Next's built Server Actions manifest", async () => {
  const state = await fixture();
  try {
    await writeFile(
      path.join(state.standalone, "app", ".next", "server", "server-reference-manifest.json"),
      `${JSON.stringify({ encryptionKey: Buffer.alloc(32, 8).toString("base64"), node: {}, edge: {} })}\n`,
    );
    await assert.rejects(
      () => packReleaseArtifact({ repoPath: state.repo, standalonePath: state.standalone, staticPath: state.staticRoot, publicPath: state.publicRoot, archivePath: state.archive, manifestPath: state.manifest }),
      { code: "SERVER_ACTIONS_BUILD_FINGERPRINT" },
    );
    await assert.rejects(() => readFile(state.archive), { code: "ENOENT" });
    await assert.rejects(() => readFile(state.manifest), { code: "ENOENT" });
  } finally { await clean(state); }
});
