#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createLinuxReleaseRuntime } from "./linux-release-runtime.mjs";
import { createProductionReleaseSlots } from "./production-release.mjs";

const HELP = `Usage:
  node ops/vps/release/release-cli.mjs status --config <absolute-config.json>
  node ops/vps/release/release-cli.mjs deploy --config <absolute-config.json> \\
    --mode <shadow|activate> --archive <absolute-release.tar> \\
    --manifest <absolute-release.manifest.json> \\
    --attestation <absolute-release.attestation.json> --source-sha <40-hex>
  node ops/vps/release/release-cli.mjs rollback --config <absolute-config.json>
  node ops/vps/release/release-cli.mjs first-cutover-prepare --config <absolute-config.json> \\
    --slot <slot> --artifact-sha256 <64-hex> --source-sha <40-hex> \\
    --rollback-url <exact-vercel-ready-url> --rollback-source-sha <40-hex> \\
    --rollback-server-actions-fingerprint <64-hex>
  node ops/vps/release/release-cli.mjs first-cutover-confirm --config <absolute-config.json> \\
    --slot <slot> --artifact-sha256 <64-hex> --source-sha <40-hex>
  node ops/vps/release/release-cli.mjs first-cutover-abort --config <absolute-config.json> \\
    --slot <slot> --artifact-sha256 <64-hex> --source-sha <40-hex>

The config supplies exactly two dedicated MoaWork slots, loopback ports,
systemd units, state/lock/env paths, reviewed Caddy configuration, and the
public readiness URL. The CLI never accepts a verifier override or secrets.
An empty VPS is proven in shadow mode before the explicit first-cutover
prepare/confirm/abort sequence. These commands never mutate DNS: prepare keeps
the active slot null, confirm requires exact public candidate health, and abort
requires exact public Vercel rollback health before removing the VPS route.
`;

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;

function parsePairs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error("options require --name value pairs");
    if (parsed.has(key)) throw new Error(`duplicate option: ${key}`);
    parsed.set(key, value);
  }
  return parsed;
}

function exactOptions(options, names) {
  const allowed = new Set(names);
  for (const key of options.keys()) if (!allowed.has(key)) throw new Error(`unknown option: ${key}`);
  for (const name of names) if (!options.has(name)) throw new Error(`missing option: ${name}`);
}

async function loadConfig(configPath) {
  if (!path.isAbsolute(configPath)) throw new Error("config path must be absolute");
  let value;
  try {
    value = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error("config must be readable canonical JSON", { cause: error });
  }
  return value;
}

export async function runReleaseCli(argv, dependencies = {}) {
  const [command, ...values] = argv;
  if (command === undefined || command === "help" || command === "--help") return { help: HELP };
  const options = parsePairs(values);
  const common = ["--config"];
  const cutoverIdentity = ["--slot", "--artifact-sha256", "--source-sha"];
  if (command === "deploy") exactOptions(options, [...common, "--mode", "--archive", "--manifest", "--attestation", "--source-sha"]);
  else if (command === "status" || command === "rollback") exactOptions(options, common);
  else if (command === "first-cutover-prepare") {
    exactOptions(options, [...common, ...cutoverIdentity, "--rollback-url", "--rollback-source-sha", "--rollback-server-actions-fingerprint"]);
  } else if (command === "first-cutover-confirm" || command === "first-cutover-abort") {
    exactOptions(options, [...common, ...cutoverIdentity]);
  }
  else throw new Error(`unknown command: ${command}`);

  const rawConfigPath = options.get("--config");
  if (!path.isAbsolute(rawConfigPath)) throw new Error("config path must be absolute");
  const config = await loadConfig(rawConfigPath);
  const runtime = await createLinuxReleaseRuntime(config, dependencies.runtimeDependencies);
  const controller = await createProductionReleaseSlots({
    runtime,
    slotIds: config.slotIds,
    timeoutMs: config.timeoutMs,
    trustedBuilderPublicKeyPath: config.trustedBuilderPublicKeyPath,
    expectedBuilder: { platform: "linux", arch: config.nodeArch, nodeVersion: config.nodeVersion },
  });
  let deployInput = null;
  if (command === "deploy") {
    const mode = options.get("--mode");
    if (mode !== "shadow" && mode !== "activate") throw new Error("mode must be shadow or activate");
    const sourceSha = options.get("--source-sha");
    if (!SHA40.test(sourceSha)) throw new Error("source-sha must be a lowercase full Git SHA");
    for (const name of ["--archive", "--manifest", "--attestation"]) if (!path.isAbsolute(options.get(name))) throw new Error(`${name} must be absolute`);
    deployInput = {
      mode,
      archivePath: path.resolve(options.get("--archive")),
      manifestPath: path.resolve(options.get("--manifest")),
      attestationPath: path.resolve(options.get("--attestation")),
      expectedSourceSha: sourceSha,
    };
    await controller.verifyDeployArtifact(deployInput);
  }
  return runtime.withExclusiveLock(async () => {
    if (command === "status") return controller.status();
    if (command === "rollback") return controller.rollback();
    if (command.startsWith("first-cutover-")) {
      const sourceSha = options.get("--source-sha");
      const artifactSha256 = options.get("--artifact-sha256");
      if (!SHA40.test(sourceSha)) throw new Error("source-sha must be a lowercase full Git SHA");
      if (!SHA64.test(artifactSha256)) throw new Error("artifact-sha256 must be a lowercase SHA-256");
      const input = { targetSlot: options.get("--slot"), sourceSha, artifactSha256 };
      if (command === "first-cutover-prepare") {
        const rollbackSourceSha = options.get("--rollback-source-sha");
        const rollbackServerActionsFingerprint = options.get("--rollback-server-actions-fingerprint");
        if (!SHA40.test(rollbackSourceSha)) throw new Error("rollback-source-sha must be a lowercase full Git SHA");
        if (!SHA64.test(rollbackServerActionsFingerprint)) throw new Error("rollback-server-actions-fingerprint must be a lowercase SHA-256");
        input.rollbackTarget = {
          provider: "vercel",
          healthUrl: options.get("--rollback-url"),
          serverActionsKeyFingerprint: rollbackServerActionsFingerprint,
          sourceSha: rollbackSourceSha,
        };
        return controller.prepareInitialCutover(input);
      }
      if (command === "first-cutover-confirm") return controller.confirmInitialCutover(input);
      return controller.abortInitialCutover(input);
    }
    return controller.deploy(deployInput);
  });
}

async function main() {
  const result = await runReleaseCli(process.argv.slice(2));
  if (result.help) process.stdout.write(result.help);
  else process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const code = typeof error?.code === "string" ? error.code : "USAGE_OR_RUNTIME";
    const message = typeof error?.message === "string" ? error.message : "release command failed";
    process.stderr.write(`MOAWORK_RELEASE_${code}: ${message}\n`);
    process.exitCode = 1;
  });
}
