import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const [workflow, checkScript, launcher] = await Promise.all([
  readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  readFile(new URL("./check.sh", import.meta.url), "utf8"),
  readFile(new URL("./run-check-windows.ps1", import.meta.url), "utf8"),
]);
const launcherPath = new URL("./run-check-windows.ps1", import.meta.url).pathname.slice(1).replaceAll("/", "\\");

function cleanTestEnvironment(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (["BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "CDPATH", "GLOBIGNORE"].includes(key.toUpperCase())
      || /^BASH_FUNC_.*%%$/iu.test(key)) delete env[key];
  }
  return { ...env, ...extra };
}

function runLauncher(path, args = [], env = cleanTestEnvironment()) {
  return spawnSync("pwsh.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path,
    ...args,
  ], { encoding: "utf8", env });
}

test("Windows CI never invokes PATH-unqualified Bash", () => {
  assert.doesNotMatch(workflow, /run:\s+bash(?:\.exe)?\s+scripts\/check\.sh/u);
  assert.equal(
    workflow.split(/\r?\n/u).filter(line => line.trim() === "run: .\\scripts\\run-check-windows.ps1").length,
    1,
  );
  assert.equal(
    checkScript.split(/\r?\n/u).filter(line => line === "node --test scripts/check-shell-entry.test.mjs").length,
    1,
  );
});

test("the launcher binds and verifies the fixed Git-for-Windows executable family", () => {
  assert.match(launcher, /GetFolderPath\(\[Environment\+SpecialFolder\]::ProgramFiles\)/u);
  assert.match(launcher, /Join-Path \$gitRoot "bin\\bash\.exe"/u);
  assert.match(launcher, /Get-AuthenticodeSignature -LiteralPath \$resolved/u);
  assert.match(launcher, /FileDescription -ne "Git for Windows"/u);
  assert.match(launcher, /\^\(MINGW\(32\|64\)\|MSYS\)_NT-/u);
  assert.match(launcher, /CHECK_GIT_BASH_ROOT_MISMATCH/u);
  assert.match(launcher, /exit \[int\]\$checkExit/u);
  assert.equal(launcher.match(/Assert-BashStartupEnvironmentClean/gmu)?.length, 3);
  assert.match(launcher, /\^BASH_FUNC_\.\*%%\$/u);
  assert.doesNotMatch(launcher, /Get-Command\s+bash/u);
  assert.doesNotMatch(launcher, /MOAWORK_.*BASH|\$env:.*BASH/u);
});

test("the real Windows launcher proves a signed Git-Bash family before product execution", { skip: process.platform !== "win32" }, () => {
  const result = runLauncher(launcherPath, ["-ProbeOnly"]);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^CHECK_SHELL_READY /mu);
  const payload = JSON.parse(result.stdout.match(/^CHECK_SHELL_READY (.+)$/mu)?.[1] ?? "null");
  assert.match(payload.path, /\\Program Files\\Git\\bin\\bash\.exe$/iu);
  assert.match(payload.family, /^(MINGW(32|64)|MSYS)_NT-/u);
  assert.equal(payload.product, "Git for Windows");
  assert.match(payload.root, /\\Program Files\\Git$/iu);
});

test("Bash startup environment is rejected before the attestation probe", { skip: process.platform !== "win32" }, () => {
  const result = runLauncher(launcherPath, ["-ProbeOnly"], cleanTestEnvironment({
    BASH_ENV: '$(printf "BASH_ENV_PRESTART\\n" >&2)/dev/null',
    "BASH_FUNC_printf%%": '() { command printf "BASH_FUNC_PRESTART\\n" >&2; }',
  }));

  assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /CHECK_BASH_STARTUP_ENV_FORBIDDEN/u);
  assert.match(result.stderr, /BASH_ENV/u);
  assert.match(result.stderr, /BASH_FUNC_printf%%/u);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /BASH_ENV_PRESTART|BASH_FUNC_PRESTART|CHECK_SHELL_READY/u);
});

test("the product path rejects imported node before payload start and preserves a clean exit", { skip: process.platform !== "win32" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "moawork-check-shell-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = join(root, "scripts");
  await mkdir(scripts);
  const copiedLauncher = join(scripts, "run-check-windows.ps1");
  await writeFile(copiedLauncher, launcher, "utf8");
  await writeFile(join(scripts, "check.sh"), '#!/usr/bin/env bash\nprintf "PRODUCT_PAYLOAD_STARTED\\n"\nnode -e "process.exit(37)"\n', "utf8");

  const rejected = runLauncher(copiedLauncher, [], cleanTestEnvironment({
    "BASH_FUNC_node%%": '() { printf "BASH_FUNC_NODE_OVERRIDE\\n" >&2; return 0; }',
  }));
  assert.equal(rejected.status, 78, `${rejected.stdout}\n${rejected.stderr}`);
  assert.match(rejected.stderr, /CHECK_BASH_STARTUP_ENV_FORBIDDEN/u);
  assert.match(rejected.stderr, /BASH_FUNC_node%%/u);
  assert.doesNotMatch(`${rejected.stdout}\n${rejected.stderr}`, /PRODUCT_PAYLOAD_STARTED|BASH_FUNC_NODE_OVERRIDE/u);

  const clean = runLauncher(copiedLauncher);
  assert.equal(clean.status, 37, `${clean.stdout}\n${clean.stderr}`);
  assert.match(clean.stdout, /CHECK_SHELL_READY/u);
  assert.match(clean.stdout, /PRODUCT_PAYLOAD_STARTED/u);
});
