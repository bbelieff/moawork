#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { deriveProvisionAuditEvidence } from "./audit-evidence.mjs";
import { renderProvisionAssets } from "./assets.mjs";
import { buildProvisionPlan, createLinuxProvisionExecutor, executeProvisionPlan } from "./installer.mjs";
import { verifyProvisionPostflight } from "./postflight.mjs";

const HELP = `Usage:
  node ops/vps/provision/provision-cli.mjs plan --manifest <absolute.json> --audit <absolute.json> --runtime-env <absolute.json> --node-archive <absolute.tar.xz> --trusted-builder <absolute.pem>
  node ops/vps/provision/provision-cli.mjs apply --manifest <absolute.json> --audit <absolute.json> --runtime-env <absolute.json> --node-archive <absolute.tar.xz> --trusted-builder <absolute.pem> --confirm-plan-sha256 <64hex>
  node ops/vps/provision/provision-cli.mjs postflight --manifest <absolute.json> --plan <absolute.json> --before-audit <absolute.json> --after-audit <absolute.json>

plan is the default-safe operation and performs no host writes. apply requires Linux root,
fresh complete audit-v2 evidence, exact absent prestate, exact Node/key/assets, and the
reviewed plan SHA. Runtime environment values are never included in output.
`;

function parseOptions(values, expected) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--") || options.has(key)) throw new Error("options require unique --name value pairs");
    options.set(key, value);
  }
  if (JSON.stringify([...options.keys()].sort()) !== JSON.stringify([...expected].sort())) throw new Error("options differ from the exact command contract");
  for (const value of options.values()) if (!path.isAbsolute(value) && !/^[0-9a-f]{64}$/u.test(value)) throw new Error("input paths must be absolute");
  return options;
}

async function jsonFile(target, read = readFile) {
  try { return JSON.parse(await read(target, "utf8")); }
  catch (error) { throw new Error("input must be readable JSON", { cause: error }); }
}

async function fileSha256(target, read = readFile) {
  return createHash("sha256").update(await read(target)).digest("hex");
}

export async function runProvisionCli(argv, dependencies = {}) {
  const [command, ...values] = argv;
  if (command === undefined || command === "help" || command === "--help") return { help: HELP };
  const read = dependencies.readFile ?? readFile;
  if (command === "postflight") {
    const options = parseOptions(values, ["--manifest", "--plan", "--before-audit", "--after-audit"]);
    const manifest = await jsonFile(options.get("--manifest"), read);
    const plan = await jsonFile(options.get("--plan"), read);
    const beforeAudit = await jsonFile(options.get("--before-audit"), read);
    const afterAudit = await jsonFile(options.get("--after-audit"), read);
    const auditContract = dependencies.auditContract ?? await import("../audit-contract.mjs");
    return verifyProvisionPostflight({
      manifest,
      plan,
      beforeAudit,
      afterAudit,
      assets: renderProvisionAssets(manifest),
      auditContract,
      nowMs: dependencies.nowMs ?? Date.now(),
      observe: dependencies.observePostflight,
    });
  }
  if (command !== "plan" && command !== "apply") throw new Error(`unknown command: ${command}`);
  const common = ["--manifest", "--audit", "--runtime-env", "--node-archive", "--trusted-builder"];
  const options = parseOptions(values, command === "apply" ? [...common, "--confirm-plan-sha256"] : common);
  const [manifest, report, runtimeEnvironment, trustedBuilderBytes] = await Promise.all([
    jsonFile(options.get("--manifest"), read),
    jsonFile(options.get("--audit"), read),
    jsonFile(options.get("--runtime-env"), read),
    read(options.get("--trusted-builder")),
  ]);
  const contract = dependencies.auditContract ?? await import("../audit-contract.mjs");
  const deriveEvidence = dependencies.deriveProvisionAuditEvidence ?? deriveProvisionAuditEvidence;
  const evidence = deriveEvidence(report, manifest, contract, { nowMs: dependencies.nowMs ?? Date.now() });
  const assets = renderProvisionAssets(manifest);
  const plan = buildProvisionPlan({
    manifest,
    auditSummary: evidence.auditSummary,
    prestate: evidence.prestate,
    runtimeEnvironment,
    nodeArchiveSha256: await fileSha256(options.get("--node-archive"), read),
    trustedBuilderBytes,
    assets,
  });
  if (command === "plan") return { applied: false, plan };
  const executor = dependencies.executor ?? createLinuxProvisionExecutor({
    manifest,
    assets,
    runtimeEnvironment,
    nodeArchivePath: options.get("--node-archive"),
    trustedBuilderBytes,
  });
  return executeProvisionPlan(plan, { apply: true, confirmPlanSha256: options.get("--confirm-plan-sha256"), executor });
}

async function main() {
  const result = await runProvisionCli(process.argv.slice(2));
  if (result.help) process.stdout.write(result.help);
  else process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`MOAWORK_PROVISION_${error?.code ?? "FAILED"}: ${error?.message ?? "provision command failed"}\n`);
    process.exitCode = 1;
  });
}
