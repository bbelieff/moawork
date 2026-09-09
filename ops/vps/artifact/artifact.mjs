#!/usr/bin/env node

import path from "node:path";
import { packReleaseArtifact, verifyReleaseArtifact } from "./contract.mjs";
import { signReleaseArtifactAttestation, verifyTrustedReleaseArtifact } from "./provenance.mjs";

const HELP = `Usage:
  node ops/vps/artifact/artifact.mjs pack \\
    --repo <source-repo> --standalone <app/.next/standalone> \\
    --static <app/.next/static> --public <app/public> \\
    --archive <release.tar> --manifest <release.manifest.json>

  node ops/vps/artifact/artifact.mjs verify \\
    --archive <release.tar> --manifest <release.manifest.json> \\
    [--destination <new-empty-release-directory>]

  node ops/vps/artifact/artifact.mjs attest \\
    --archive <release.tar> --manifest <release.manifest.json> \\
    --private-key <trusted-builder-ed25519.pem> \\
    --attestation <new-release.attestation.json>

  node ops/vps/artifact/artifact.mjs verify-trusted \\
    --archive <release.tar> --manifest <release.manifest.json> \\
    --attestation <release.attestation.json> \\
    --public-key <pinned-builder-ed25519.pub.pem> \\
    [--destination <new-empty-release-directory>]

The manifest binds exact source commit/tree, package-lock SHA-256, builder
Node/npm/platform/arch, every payload entry, and the archive SHA-256.
SHA-256 proves transfer integrity only. Production trust additionally requires
the protected exact-main Linux release-artifact job to run the extracted
standalone health smoke and sign that evidence with a separately pinned
Ed25519 builder key. The pinned key holder is the provenance root of trust;
CI identity strings alone are not remote attestation. Environment files,
private-key blocks, and known credential-shaped
config keys are rejected; this is not a general secret scanner.
`;

function parseOptions(values) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error("options require --name value pairs");
    if (options.has(key)) throw new Error(`duplicate option: ${key}`);
    options.set(key, value);
  }
  return options;
}

function requireOptions(options, names) {
  const allowed = new Set(names);
  for (const key of options.keys()) if (!allowed.has(key)) throw new Error(`unknown option: ${key}`);
  const result = {};
  for (const name of names) {
    if (!options.has(name)) throw new Error(`missing option: ${name}`);
    result[name.slice(2)] = path.resolve(options.get(name));
  }
  return result;
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  const options = parseOptions(values);
  let result;
  if (command === "pack") {
    const required = requireOptions(options, ["--repo", "--standalone", "--static", "--public", "--archive", "--manifest"]);
    result = await packReleaseArtifact({
      repoPath: required.repo,
      standalonePath: required.standalone,
      staticPath: required.static,
      publicPath: required.public,
      archivePath: required.archive,
      manifestPath: required.manifest,
    });
  } else if (command === "verify") {
    const allowed = new Set(["--archive", "--manifest", "--destination"]);
    for (const key of options.keys()) if (!allowed.has(key)) throw new Error(`unknown option: ${key}`);
    if (!options.has("--archive") || !options.has("--manifest")) throw new Error("verify requires --archive and --manifest");
    result = await verifyReleaseArtifact({
      archivePath: path.resolve(options.get("--archive")),
      manifestPath: path.resolve(options.get("--manifest")),
      destinationPath: options.has("--destination") ? path.resolve(options.get("--destination")) : null,
    });
  } else if (command === "attest") {
    const required = requireOptions(options, ["--archive", "--manifest", "--private-key", "--attestation"]);
    result = await signReleaseArtifactAttestation({
      archivePath: required.archive,
      manifestPath: required.manifest,
      privateKeyPath: required.privateKey,
      attestationPath: required.attestation,
    });
  } else if (command === "verify-trusted") {
    const allowed = new Set(["--archive", "--manifest", "--attestation", "--public-key", "--destination"]);
    for (const key of options.keys()) if (!allowed.has(key)) throw new Error(`unknown option: ${key}`);
    for (const key of ["--archive", "--manifest", "--attestation", "--public-key"]) {
      if (!options.has(key)) throw new Error(`missing option: ${key}`);
    }
    result = await verifyTrustedReleaseArtifact({
      archivePath: path.resolve(options.get("--archive")),
      manifestPath: path.resolve(options.get("--manifest")),
      attestationPath: path.resolve(options.get("--attestation")),
      trustedPublicKeyPath: path.resolve(options.get("--public-key")),
      destinationPath: options.has("--destination") ? path.resolve(options.get("--destination")) : null,
    });
  } else {
    throw new Error(`unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const code = typeof error?.code === "string" ? error.code : "USAGE_OR_RUNTIME";
  const message = typeof error?.message === "string" ? error.message : "artifact command failed";
  process.stderr.write(`MOAWORK_ARTIFACT_${code}: ${message}\n`);
  process.exitCode = 1;
});
