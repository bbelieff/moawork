import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const auditPath = new URL("./audit-host-readonly.sh", import.meta.url);
const auditFile = fileURLToPath(auditPath);
// Fresh cold-start measurements on the Windows/Git-Bash review lane reached
// ~7.1 seconds. Keep a finite >2x envelope without permitting a hung fixture.
const BASH_FIXTURE_TIMEOUT_MS = 15_000;

function bashPath() {
  return process.platform === "win32"
    ? "C:\\Program Files\\Git\\bin\\bash.exe"
    : "/bin/bash";
}

function shellPath(path) {
  if (process.platform !== "win32") return path;
  const match = path.match(/^([A-Za-z]):\\(.*)$/u);
  assert.ok(match, `unexpected Windows path: ${path}`);
  return `/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

test("the read-only audit never executes the PM2 CLI", async () => {
  const source = await readFile(auditPath, "utf8");
  const executableSource = source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  assert.doesNotMatch(executableSource, /\$\([^\n]*\bpm2\b/);
  assert.doesNotMatch(
    executableSource,
    /\bpm2\s+(?:--version|pid|jlist|show|describe)\b/,
  );
  assert.match(source, /field pm2_process_inventory not_collected_without_mutating_cli/);
});

test("a present fail-on-call PM2 fixture is discovered but never executed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-pm2-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sentinel = join(root, "pm2-was-called");
  const stub = join(root, "pm2");
  await writeFile(stub, `#!/bin/sh\nprintf called > '${sentinel.replaceAll("'", "'\\''")}'\nexit 97\n`, "utf8");
  await chmod(stub, 0o755);

  const command = `PATH=${shellQuote(shellPath(root))}:/usr/bin:/bin; source ${shellQuote(shellPath(auditFile))} && inventory_pm2`;
  const result = spawnSync(bashPath(), ["--noprofile", "--norc", "-c", command], {
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "" },
    timeout: BASH_FIXTURE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /tool_pm2=present_not_executed/);
  assert.doesNotMatch(result.stdout, /schema=|observed_at_utc=|result=complete/);
  await assert.rejects(readFile(sentinel), { code: "ENOENT" });
});

test("container identities remain local inspect handles", async () => {
  const source = await readFile(auditPath, "utf8");

  assert.match(source, /LC_ALL=C sort/);
  assert.match(source, /field "hermes_\$\{container_index\}_state"/);
  assert.doesNotMatch(source, /field "hermes_\$\{container\/\//);
});

test("Docker fixture names never enter the emitted inventory schema", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-docker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stub = join(root, "docker");
  await writeFile(
    stub,
    "#!/bin/sh\n" +
      "case \"$1\" in\n" +
      "  ps) printf 'hermes-private-b\\nhermes-private-a\\n' ;;\n" +
      "  inspect) printf 'running 0 671088640 500000000 128\\n' ;;\n" +
      "  *) exit 97 ;;\n" +
      "esac\n",
    "utf8",
  );
  await chmod(stub, 0o755);

  const command = `PATH=${shellQuote(shellPath(root))}:/usr/bin:/bin; source ${shellQuote(shellPath(auditFile))} && inventory_hermes`;
  const result = spawnSync(bashPath(), ["--noprofile", "--norc", "-c", command], {
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "" },
    timeout: BASH_FIXTURE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /hermes_container_count=2/);
  assert.match(result.stdout, /hermes_1_state=running 0 671088640 500000000 128/);
  assert.match(result.stdout, /hermes_2_state=running 0 671088640 500000000 128/);
  assert.doesNotMatch(result.stdout, /private-a|private-b/);
  assert.doesNotMatch(result.stdout, /schema=|observed_at_utc=|result=complete/);
});
