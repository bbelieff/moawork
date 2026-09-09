#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

function count(text, fragment) {
  return text.split(fragment).length - 1;
}

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote && line[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "#" && (index === 0 || /\s/u.test(line[index - 1]))) return line.slice(0, index).trimEnd();
  }
  return line.trimEnd();
}

function parsedLines(source) {
  return source.replaceAll("\r\n", "\n").split("\n").flatMap((raw, lineNumber) => {
    if (raw.includes("\t")) throw new Error(`tabs:${lineNumber + 1}`);
    const withoutComment = stripComment(raw);
    if (!withoutComment.trim()) return [];
    const indent = withoutComment.length - withoutComment.trimStart().length;
    return [{ indent, text: withoutComment.trimStart(), lineNumber: lineNumber + 1 }];
  });
}

function mappingEntry(line) {
  const match = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/u.exec(line.text);
  if (!match) throw new Error(`mapping:${line.lineNumber}`);
  return { key: match[1], value: match[2] ?? "" };
}

function blockEnd(lines, index) {
  const indent = lines[index].indent;
  let end = index + 1;
  while (end < lines.length && lines[end].indent > indent) end += 1;
  return end;
}

function childMap(lines, parentIndex, childIndent) {
  const end = blockEnd(lines, parentIndex);
  const result = new Map();
  for (let index = parentIndex + 1; index < end; index += 1) {
    if (lines[index].indent !== childIndent) continue;
    const entry = mappingEntry(lines[index]);
    if (result.has(entry.key)) throw new Error(`duplicate:${entry.key}:${lines[index].lineNumber}`);
    result.set(entry.key, { ...entry, index, end: blockEnd(lines, index) });
  }
  return result;
}

function exactMap(map, expected, label, problems) {
  const actual = [...map.keys()].sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    problems.push(`structure:${label} keys`);
  }
}

function stepsForJob(lines, job) {
  const fields = childMap(lines, job.index, 4);
  const steps = fields.get("steps");
  if (!steps || steps.value !== "") throw new Error("job steps");
  const result = new Map();
  for (let index = steps.index + 1; index < steps.end; index += 1) {
    const line = lines[index];
    if (line.indent !== 6 || !line.text.startsWith("- name: ")) continue;
    const name = line.text.slice("- name: ".length).trim();
    let end = index + 1;
    while (end < steps.end && !(lines[end].indent === 6 && lines[end].text.startsWith("- name: "))) end += 1;
    if (!name || result.has(name)) throw new Error(`step:${name || line.lineNumber}`);
    const fields = new Map();
    for (let fieldIndex = index + 1; fieldIndex < end; fieldIndex += 1) {
      if (lines[fieldIndex].indent !== 8) continue;
      const entry = mappingEntry(lines[fieldIndex]);
      if (fields.has(entry.key)) throw new Error(`duplicate:${name}:${entry.key}:${lines[fieldIndex].lineNumber}`);
      fields.set(entry.key, entry);
    }
    result.set(name, { fields, text: lines.slice(index, end).map((entry) => entry.text).join("\n") });
  }
  return { fields, steps: result };
}

function secretReferences(text) {
  return [...text.matchAll(/\$\{\{([^}]*(?:\bsecrets\b)[^}]*)\}\}/gu)].map((match) => match[0]).sort();
}

function fingerprint(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function releaseArtifactWorkflowStepFingerprints(source) {
  const lines = parsedLines(source);
  lines.unshift({ indent: -1 });
  const jobsNode = childMap(lines, 0, 0).get("jobs");
  const jobs = childMap(lines, jobsNode.index, 2);
  return Object.fromEntries(["preflight", "build-smoke", "release-artifact"].flatMap((jobName) => {
    const job = stepsForJob(lines, jobs.get(jobName));
    return [...job.steps].map(([stepName, step]) => [`${jobName}/${stepName}`, fingerprint(step.text)]);
  }));
}

const STEP_CONTRACT = Object.freeze({
  preflight: Object.freeze({
    "Refuse an unprotected or stale dispatch before secret access": ["env", "run", "shell"],
  }),
  "build-smoke": Object.freeze({
    "Require protected exact main": ["env", "run", "shell"],
    "Checkout exact source": ["uses", "with"],
    "Verify checkout identity": ["run", "shell"],
    "Use Node.js 22": ["uses", "with"],
    "Install exact dependencies": ["run", "shell"],
    "Build once with source and output provenance": ["env", "run", "shell"],
    "Pack immutable standalone archive": ["id", "run", "shell"],
    "Prove native runtime without signer material": ["env", "run", "shell"],
    "Transfer exact unsigned bundle to isolated signer": ["uses", "with"],
  }),
  "release-artifact": Object.freeze({
    "Require protected exact main": ["env", "run", "shell"],
    "Checkout exact signing verifier": ["uses", "with"],
    "Verify signing verifier identity": ["run", "shell"],
    "Use Node.js 22 without dependency lifecycle": ["uses", "with"],
    "Download exact unsigned bundle": ["uses", "with"],
    "Sign bounded smoke evidence and verify without payload execution": ["env", "run", "shell"],
    "Publish exact restricted release outputs": ["uses", "with"],
  }),
});

const STEP_FINGERPRINTS = Object.freeze({
  "preflight/Refuse an unprotected or stale dispatch before secret access": "8f644c11b571fd44e100aa1b03d5c5eb67c6c722db4f472974ff955775f48db8",
  "build-smoke/Require protected exact main": "cc8274d698074e4b679e5e666f2b64b7009299994a3c2d4528d3f22bcd5337f9",
  "build-smoke/Checkout exact source": "04da3568c9f692b71a0cb8fdcc8d621dbea889b7cd89951bb0d53610151db229",
  "build-smoke/Verify checkout identity": "b6c1453f927c0d969fb1da4e6cb030ca2fb4563c3555d7fb62b77c56e5e1f388",
  "build-smoke/Use Node.js 22": "68f70d6cd514993f637bc917aefc95f53edf98632bd83679117e7f7cfd9166f3",
  "build-smoke/Install exact dependencies": "382eb618519c4f7f0f0706b4e7e24ca4624a7a168a86aba6441279c441df9512",
  "build-smoke/Build once with source and output provenance": "9f947d908182e60cdf24fda1dca50b2516a938fa8aad7aa4335885b5e75f4465",
  "build-smoke/Pack immutable standalone archive": "80ef9dfc1ccff6d889bbaf47c1e894e8a69f07f585057707e9a937858373719c",
  "build-smoke/Prove native runtime without signer material": "10856290517da470b8773eccbf7afcb9786908d99ac5179dbd3dc58e63f45d33",
  "build-smoke/Transfer exact unsigned bundle to isolated signer": "49e361a00c885be8afdba074d4a7e2e1b5b1a4a3c9a01ee287bbc153e182dc8a",
  "release-artifact/Require protected exact main": "cc8274d698074e4b679e5e666f2b64b7009299994a3c2d4528d3f22bcd5337f9",
  "release-artifact/Checkout exact signing verifier": "096a7ae61329aa23d87cc72e04085dfc093a4191e943dbad6dfd7b1bc58edf4c",
  "release-artifact/Verify signing verifier identity": "3fbd038b43467ab64833c24b6c625938348d9258c6ab14edbedd0d20fee585a5",
  "release-artifact/Use Node.js 22 without dependency lifecycle": "b15efc8c9e5ad8d7fc9f61c5f5a180f48bcfcdd131ee2fffba984ce45055b0c8",
  "release-artifact/Download exact unsigned bundle": "66c17e6874a40c346c540df9a28e1975c8c06abc225b263f86ddc0eba2a6b36a",
  "release-artifact/Sign bounded smoke evidence and verify without payload execution": "6cf0cfdf9f6a429e39c6fb479f6dd8ce06d56f2618fd584ed83c63638bdcbbed",
  "release-artifact/Publish exact restricted release outputs": "1b543fdb7ef5898d4b221a19b02d8de5d964f9a64e700d43964e2c8045264310",
});

function validateSteps(jobName, job, problems) {
  const contract = STEP_CONTRACT[jobName];
  exactMap(job.steps, Object.keys(contract), `${jobName} steps`, problems);
  for (const [name, expectedFields] of Object.entries(contract)) {
    const step = job.steps.get(name);
    if (!step) continue;
    exactMap(step.fields, expectedFields, `${jobName}/${name} fields`, problems);
    const expectedFingerprint = STEP_FINGERPRINTS[`${jobName}/${name}`];
    if (expectedFingerprint && fingerprint(step.text) !== expectedFingerprint) problems.push(`structure:step fingerprint:${jobName}/${name}`);
  }
}

function validateStructure(source, problems) {
  try {
    const lines = parsedLines(source);
    const virtual = { indent: -1 };
    lines.unshift(virtual);
    const top = childMap(lines, 0, 0);
    exactMap(top, ["name", "on", "permissions", "concurrency", "jobs"], "top-level", problems);
    const trigger = top.get("on");
    if (!trigger || trigger.value !== "") problems.push("structure:on must be a block");
    else exactMap(childMap(lines, trigger.index, 2), ["workflow_dispatch"], "triggers", problems);
    const permissions = top.get("permissions");
    if (!permissions || permissions.value !== "") problems.push("structure:permissions must be a block");
    else {
      const values = childMap(lines, permissions.index, 2);
      exactMap(values, ["contents"], "permissions", problems);
      if (values.get("contents")?.value !== "read") problems.push("structure:contents permission");
    }
    const jobsNode = top.get("jobs");
    if (!jobsNode || jobsNode.value !== "") throw new Error("jobs");
    const jobs = childMap(lines, jobsNode.index, 2);
    exactMap(jobs, ["preflight", "build-smoke", "release-artifact"], "jobs", problems);
    const preflight = stepsForJob(lines, jobs.get("preflight"));
    exactMap(preflight.fields, ["name", "runs-on", "timeout-minutes", "steps"], "preflight job", problems);
    const build = stepsForJob(lines, jobs.get("build-smoke"));
    exactMap(build.fields, ["name", "needs", "environment", "runs-on", "timeout-minutes", "steps"], "build-smoke job", problems);
    const release = stepsForJob(lines, jobs.get("release-artifact"));
    exactMap(release.fields, ["name", "needs", "environment", "runs-on", "timeout-minutes", "steps"], "release job", problems);
    validateSteps("preflight", preflight, problems);
    validateSteps("build-smoke", build, problems);
    validateSteps("release-artifact", release, problems);
    const preflightText = lines.slice(jobs.get("preflight").index, jobs.get("preflight").end).map((entry) => entry.text).join("\n");
    if (secretReferences(preflightText).length > 0) problems.push("structure:preflight secret exposure");
    const expectedSecrets = new Map([
      ["Build once with source and output provenance", ["NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"]],
      ["Prove native runtime without signer material", ["NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"]],
      ["Sign bounded smoke evidence and verify without payload execution", ["MOAWORK_RELEASE_SIGNING_KEY_PEM"]],
    ]);
    for (const [jobName, job] of [["build-smoke", build], ["release-artifact", release]]) {
      for (const [name, step] of job.steps) {
        const actual = secretReferences(step.text);
        const expected = (expectedSecrets.get(name) ?? []).map((secret) => `\${{ secrets.${secret} }}`).sort();
        if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
          problems.push(`structure:secret placement:${jobName}/${name}`);
        }
      }
    }
    for (const required of expectedSecrets.keys()) {
      if (!build.steps.has(required) && !release.steps.has(required)) problems.push(`structure:missing step:${required}`);
    }
  } catch (error) {
    problems.push(`structure:parse:${error instanceof Error ? error.message : "unknown"}`);
  }
}

export function releaseArtifactWorkflowProblems(source) {
  const problems = [];
  validateStructure(source, problems);
  const requireText = (fragment, label) => {
    if (!source.includes(fragment)) problems.push(`missing:${label}`);
  };
  const forbidText = (fragment, label) => {
    if (source.includes(fragment)) problems.push(`forbidden:${label}`);
  };

  requireText("  workflow_dispatch:\n", "manual-only trigger");
  forbidText("  push:\n", "push trigger");
  forbidText("  pull_request:\n", "pull-request trigger");
  forbidText("  schedule:\n", "schedule trigger");
  requireText("  contents: read\n", "read-only token");
  requireText("  cancel-in-progress: false\n", "non-cancelling serialization");
  requireText("  preflight:\n", "secret-free control-plane preflight");
  requireText("      - name: Refuse an unprotected or stale dispatch before secret access\n", "pre-secret protected-main proof");
  requireText("  build-smoke:\n", "isolated build and smoke job id");
  requireText("  release-artifact:\n", "isolated signing job id");
  requireText("    needs: build-smoke\n", "signing waits for bounded smoke evidence");
  requireText("      name: moawork-vps-release-artifact\n", "dedicated protected environment");
  requireText("    runs-on: ubuntu-24.04\n", "reviewed native Linux runner");
  requireText("test \"$GITHUB_REF_PROTECTED\" = true", "runtime protected-ref proof");
  requireText('[[ "$EXPECTED_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]', "strict source SHA input");
  requireText("test \"$GITHUB_SHA\" = \"$EXPECTED_SOURCE_SHA\"", "operator exact SHA proof");
  requireText("persist-credentials: false", "checkout credential removal");
  requireText("node-version: 22.23.2", "reviewed Node ABI");
  requireText("NEXT_PUBLIC_APP_VERSION: ${{ github.sha }}", "exact public app version");
  requireText("NEXT_PUBLIC_SUPABASE_URL: https://srtvmpcosekduvsscsyz.supabase.co", "canonical public Supabase origin");
  requireText("NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ vars.NEXT_PUBLIC_SUPABASE_ANON_KEY }}", "environment-scoped public Supabase key");
  requireText("NEXT_PUBLIC_POSTHOG_KEY: ${{ vars.NEXT_PUBLIC_POSTHOG_KEY }}", "environment-scoped public analytics key");
  requireText("MOAWORK_RELEASE_PUBLIC_CONFIG_SHA256: ${{ vars.MOAWORK_RELEASE_PUBLIC_CONFIG_SHA256 }}", "reviewed public config pin");
  requireText("node scripts/ci/validate-vps-release-environment.mjs", "executable release environment validation");
  requireText("node scripts/ci/build-artifact.mjs --workspace-build", "single verified build seam");
  requireText("node ops/vps/artifact/artifact.mjs pack", "immutable pack");
  requireText("node ops/vps/artifact/artifact.mjs smoke", "native smoke without signer material");
  requireText('test "$(stat -c %u "$OUTPUT_DIRECTORY")" = "$(id -u)"', "smoke control-directory owner check");
  requireText('test "$(stat -c %a "$OUTPUT_DIRECTORY")" = 700', "smoke control-directory mode check");
  requireText('test ! -e "$SMOKE_EVIDENCE_PATH"', "fresh smoke evidence path");
  requireText("node ops/vps/artifact/artifact.mjs attest-evidence", "bounded evidence signing");
  requireText("node ops/vps/artifact/artifact.mjs verify-trusted", "trusted verification before upload");
  requireText("${{ secrets.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY }}", "runtime-key secret");
  requireText("${{ secrets.MOAWORK_RELEASE_SIGNING_KEY_PEM }}", "signing-key secret");
  requireText("EXPECTED_SIGNER_KEY_ID: ${{ vars.MOAWORK_RELEASE_SIGNER_KEY_ID }}", "independent signer key pin");
  requireText("keyId !== process.env.EXPECTED_SIGNER_KEY_ID", "signer key pin enforcement");
  requireText("unset MOAWORK_RELEASE_SIGNING_KEY_PEM", "signing-key environment cleanup");
  requireText("trap cleanup EXIT", "signing-key file cleanup");
  requireText("if-no-files-found: error", "bounded artifact upload");
  requireText("overwrite: false", "immutable upload");
  requireText("include-hidden-files: false", "hidden-file exclusion");
  requireText("retention-days: 1", "bounded confidential artifact retention");
  forbidText("curl ", "network deploy command");
  forbidText("ssh ", "host mutation command");
  forbidText("scp ", "host copy command");
  forbidText("rsync ", "host copy command");
  forbidText("node ops/vps/artifact/artifact.mjs attest \\", "combined payload and signing-key command");

  if (count(source, "node scripts/ci/build-artifact.mjs --workspace-build") !== 1) problems.push("count:workspace build must run exactly once");
  if (count(source, "runs-on: ubuntu-24.04") !== 3) problems.push("count:all jobs require the reviewed Linux runner");
  if (count(source, 'test "$GITHUB_REF_PROTECTED" = true') !== 3) problems.push("count:protected ref must be checked before each privileged job");
  if (count(source, "secrets.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY") !== 2) problems.push("count:runtime key must reach only build and attestation");
  if (count(source, "secrets.MOAWORK_RELEASE_SIGNING_KEY_PEM") !== 1) problems.push("count:signing key must reach only attestation");

  const order = [
    "node scripts/ci/build-artifact.mjs --workspace-build",
    "node ops/vps/artifact/artifact.mjs pack",
    "node ops/vps/artifact/artifact.mjs smoke",
    "actions/download-artifact@",
    "node ops/vps/artifact/artifact.mjs attest-evidence",
    "node ops/vps/artifact/artifact.mjs verify-trusted",
    "Publish exact restricted release outputs",
  ].map((fragment) => source.indexOf(fragment));
  if (order.some((index) => index < 0) || order.some((index, position) => position > 0 && index <= order[position - 1])) {
    problems.push("order:build-pack-attest-verify-upload");
  }

  return problems;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const root = path.resolve(import.meta.dirname, "..");
  const workflow = readFileSync(path.join(root, ".github/workflows/vps-release-artifact.yml"), "utf8").replaceAll("\r\n", "\n");
  const problems = releaseArtifactWorkflowProblems(workflow);
  if (problems.length > 0) {
    console.error(`VPS_RELEASE_ARTIFACT_WORKFLOW_FAIL ${JSON.stringify(problems)}`);
    process.exitCode = 1;
  } else {
    console.log("VPS_RELEASE_ARTIFACT_WORKFLOW_PASS");
  }
}
