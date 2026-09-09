import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeTest from "node:test";
import { fileURLToPath } from "node:url";
import { AUDIT_REQUIRED_FIELDS_DIGEST, validateHostAudit } from "./audit-contract.mjs";

const auditPath = new URL("./audit-host-readonly.sh", import.meta.url);
const auditFile = fileURLToPath(auditPath);
const BASH_FIXTURE_TIMEOUT_MS = 60_000;

function test(name, fn) {
  return nodeTest(name, { concurrency: true }, fn);
}

function bashPath() {
  return process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/bash";
}

function shellPath(path) {
  if (process.platform !== "win32") return path;
  const match = path.match(/^([A-Za-z]):\\(.*)$/u);
  assert.ok(match, "unexpected Windows path: " + path);
  return "/" + match[1].toLowerCase() + "/" + match[2].replaceAll("\\", "/");
}

function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function runBash(command, pathEntries = []) {
  const fixturePath = [...pathEntries.map(shellPath), "/usr/bin", "/bin"].join(":");
  return spawnSync(bashPath(), ["--noprofile", "--norc", "-c", "PATH=" + shellQuote(fixturePath) + "; " + command], {
    encoding: "utf8",
    env: { ...process.env, PATH: process.env.PATH ?? "" },
    timeout: BASH_FIXTURE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
}

const accountMetadataGetentFixture = `#!/bin/sh
lock=$(printf '\\041')
case "$1" in
  passwd)
    case "$2" in
      moawork) printf 'moawork:x:2101:2101::/nonexistent:/usr/sbin/nologin\\n' ;;
      moawork-deploy) printf 'moawork-deploy:x:2102:2102::/home/moawork-deploy:/bin/bash\\n' ;;
      *) exit 2 ;;
    esac
    ;;
  shadow)
    case "$2" in
      moawork) printf '%s:%s:%s:%s:%s:%s:%s:%s:%s\\n' moawork "$lock" 1 2 3 4 5 6 7 ;;
      moawork-deploy) printf '%s:%s:%s:%s:%s:%s:%s:%s:%s\\n' moawork-deploy "$lock" 1 2 3 4 5 6 7 ;;
      *) exit 2 ;;
    esac
    ;;
  *) exit 2 ;;
esac
`;

test("collector syntax and schema digest stay bound to the consumer contract", async () => {
  const syntax = runBash("bash -n " + shellQuote(shellPath(auditFile)));
  assert.equal(syntax.status, 0, syntax.stderr);
  const source = await readFile(auditPath, "utf8");
  assert.match(source, /moawork-vps-readonly-v2/u);
  assert.match(source, new RegExp(AUDIT_REQUIRED_FIELDS_DIGEST, "u"));
  assert.match(source, /ss -H -lntup/u);
  assert.doesNotMatch(source, /["']?validate["']? --config/u);
  assert.match(source, /read-only-adapt/u);
  assert.match(source, /CADDY_IMPORT_CLOSURE_INCOMPLETE/u);
  assert.match(source, /cpuUsageNSec.*json_nullable_string "\$cpu"/u);
  assert.match(source, /memoryCurrentBytes.*json_nullable_string "\$memory"/u);
});

test("collector has no package, service, log, environment, or customer-data mutation path", async () => {
  const source = (await readFile(auditPath, "utf8")).split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
  assert.doesNotMatch(source, /\b(?:apt|apt-get|dnf|yum|apk|npm|pnpm|yarn)\s+(?:install|add|update|upgrade)\b/u);
  assert.doesNotMatch(source, /\bsystemctl\s+(?:start|stop|restart|reload|enable|disable|daemon-reload)\b/u);
  assert.doesNotMatch(source, /\b(?:journalctl|docker\s+logs|pm2|psql|supabase)\b/u);
  assert.doesNotMatch(source, /\/proc\/.*\/environ|\.Config\.Env|printenv/u);
  assert.doesNotMatch(source, /(?:^|[;&|]\s*)(?:rm|mv|cp|install|mkdir|touch|chmod|chown|tee)\b/mu);
});

test("JSON quoting covers non-printing control bytes", () => {
  const command = "source " + shellQuote(shellPath(auditFile)) + "; json_quote $'a\\001b\\033c'";
  const result = runBash(command);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.equal(JSON.parse(result.stdout), "a\u0001b\u001bc");
});

test("rootless and missing probes produce valid incomplete evidence, never PASS", () => {
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; for name in \"\${REQUIRED_PROBES[@]}\"; do probe \"$name\" absent ABSENT null; done"
    + "; probe identity.auditActor unknown AUDIT_REQUIRES_ROOT '{\"egid\":1000,\"euid\":1000,\"supplementaryGids\":[1000]}'"
    + "; emit_report";
  const result = runBash(command);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.complete, false);
  assert.equal(report.incompleteReasons.length, 17);
  assert.ok(report.incompleteReasons.some((reason) => reason.code === "AUDIT_REQUIRES_ROOT" && reason.probe === "identity.auditActor"));
  assert.doesNotThrow(() => validateHostAudit(report));
  assert.throws(() => validateHostAudit(report, { requireComplete: true }), /complete audit evidence is required/u);
});

test("account query failure is error, not authoritative absence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-account-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const getent = join(root, "getent");
  await writeFile(getent, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(getent, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_accounts; printf '%s|%s|%s' \"\${PROBE_STATE[identity.accounts]}\" \"\${PROBE_REASON[identity.accounts]}\" \"\${PROBE_VALUE[identity.accounts]}\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /^error\|ACCOUNT_METADATA_UNREADABLE\|/u);
  assert.match(result.stdout, /"present":false/u);
});

test("account evidence excludes the primary gid and keeps only sorted unique supplementary gids", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-account-groups-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const getent = join(root, "getent");
  const id = join(root, "id");
  await writeFile(getent, accountMetadataGetentFixture, "utf8");
  await writeFile(id, "#!/bin/sh\ncase \"$2\" in\n moawork) printf '2101 2101\\n' ;;\n moawork-deploy) printf '2102 2101 2101 2102\\n' ;;\n *) exit 5 ;;\nesac\n", "utf8");
  await chmod(getent, 0o755);
  await chmod(id, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_accounts; printf '%s|%s' \"\${PROBE_STATE[identity.accounts]}\" \"\${PROBE_VALUE[identity.accounts]}\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  const separator = result.stdout.indexOf("|");
  assert.equal(result.stdout.slice(0, separator), "ok");
  const accounts = JSON.parse(result.stdout.slice(separator + 1));
  assert.deepEqual(accounts.find(({ name }) => name === "moawork").supplementaryGids, []);
  assert.deepEqual(accounts.find(({ name }) => name === "moawork-deploy").supplementaryGids, [2101]);
});

test("account supplementary group query failure is not reported as an authoritative empty set", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-account-group-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const getent = join(root, "getent");
  const id = join(root, "id");
  await writeFile(getent, accountMetadataGetentFixture, "utf8");
  await writeFile(id, "#!/bin/sh\nexit 5\n", "utf8");
  await chmod(getent, 0o755);
  await chmod(id, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_accounts; printf '%s|%s|%s' \"\${PROBE_STATE[identity.accounts]}\" \"\${PROBE_REASON[identity.accounts]}\" \"\${PROBE_VALUE[identity.accounts]}\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /^error\|ACCOUNT_METADATA_UNREADABLE\|/u);
  const accounts = JSON.parse(result.stdout.slice(result.stdout.indexOf("|", result.stdout.indexOf("|") + 1) + 1));
  assert.deepEqual(accounts.map(({ supplementaryGids }) => supplementaryGids), [[], []]);
});

test("identity group query failure cannot produce a root PASS", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-id-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = join(root, "id");
  await writeFile(id, "#!/bin/sh\ncase \"$1\" in\n -u|-g) printf '0\\n' ;;\n -G) exit 5 ;;\n *) exit 5 ;;\nesac\n", "utf8");
  await chmod(id, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_actor; printf '%s|%s' \"\${PROBE_STATE[identity.auditActor]}\" \"\${PROBE_REASON[identity.auditActor]}\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.equal(result.stdout, "error|IDENTITY_QUERY_FAILED");
});

test("filesystem evidence records lstat ownership, DAC, links, realpath, and ancestors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target");
  await writeFile(target, "fixture", "utf8");
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; metadata_json " + shellQuote(shellPath(target)) + " fixture.target";
  const result = runBash(command);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.logicalKey, "fixture.target");
  assert.equal(value.type, "regular file");
  assert.equal(Number.isInteger(value.uid), true);
  assert.equal(Number.isInteger(value.gid), true);
  assert.match(value.mode, /^[0-7]{3,4}$/u);
  assert.equal(Number.isInteger(value.nlink), true);
  assert.equal(typeof value.realpath, "string");
  assert.ok(value.ancestors.length > 0);
  assert.equal(typeof value.ancestorsSafe, "boolean");
});

test("listener query error is never collapsed to zero listeners", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-listener-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ss = join(root, "ss");
  await writeFile(ss, "#!/bin/sh\nexit 4\n", "utf8");
  await chmod(ss, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_listeners; printf '%s|%s|%s|%s' \"\${PROBE_STATE[listeners.all]}\" \"\${PROBE_REASON[listeners.all]}\" \"\${PROBE_STATE[listeners.candidatePorts]}\" \"\${PROBE_REASON[listeners.candidatePorts]}\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.equal(result.stdout, "error|LISTENER_QUERY_FAILED|error|LISTENER_QUERY_FAILED");
});

test("curl timeout cannot be reported healthy even if write-out contains 200", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-curl-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const curl = join(root, "curl");
  await writeFile(curl, "#!/bin/sh\nprintf '200|9.999'\nexit 28\n", "utf8");
  await chmod(curl, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; http_health_json http://127.0.0.1:3000/api/health local";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  const health = JSON.parse(result.stdout);
  assert.equal(health.httpStatus, null);
  assert.equal(health.latencyMs, null);
  assert.match(health.identityDigest, /^[a-f0-9]{64}$/u);
});

test("partial nonzero systemd sample query makes resource evidence incomplete", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-systemd-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemctl = join(root, "systemctl");
  await writeFile(systemctl, "#!/bin/sh\nprintf 'MemoryCurrent=12\\nCPUUsageNSec=34\\nTasksCurrent=2\\n'\nexit 1\n", "utf8");
  await chmod(systemctl, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_samples_bounded 1; printf '%s|%s' \"\${PROBE_STATE[resources.samples]}\" \"\${PROBE_REASON[resources.samples]}\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.equal(result.stdout, "error|SERVICE_RESOURCE_QUERY_FAILED");
});

test("loaded systemd unit with unreadable fragment is a query failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-systemd-fragment-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemctl = join(root, "systemctl");
  await writeFile(systemctl, "#!/bin/sh\nprintf 'LoadState=loaded\\nActiveState=active\\nSubState=running\\nMainPID=10\\nNRestarts=0\\nMemoryCurrent=12\\nCPUUsageNSec=34\\nMemoryMax=infinity\\nTasksCurrent=2\\nTasksMax=512\\nCPUQuotaPerSecUSec=infinity\\nRestart=on-failure\\nUser=root\\nGroup=root\\nFragmentPath=/missing/private/unit.service\\nDropInPaths=\\n'\n", "utf8");
  await chmod(systemctl, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; if systemd_service_json sample.service '{\"checks\":[],\"state\":\"not-applicable\"}' >/dev/null; then printf unexpected; else printf rejected; fi";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.equal(result.stdout, "rejected");
});

test("missing or non-decimal systemd counters make the report incomplete", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-systemd-unset-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fragment = join(root, "inactive.service");
  const systemctl = join(root, "systemctl");
  await writeFile(fragment, "[Service]\nExecStart=/bin/true\n", "utf8");
  for (const bad of ["missing", "[not set]", "-1", "infinity"]) {
    const cpuLine = bad === "missing" ? "" : `CPUUsageNSec=${bad}\\n`;
    await writeFile(systemctl, "#!/bin/sh\nprintf 'LoadState=loaded\\nActiveState=inactive\\nSubState=dead\\nMainPID=0\\nNRestarts=0\\nMemoryCurrent=12\\n" + cpuLine + "MemoryMax=infinity\\nTasksCurrent=2\\nTasksMax=512\\nCPUQuotaPerSecUSec=infinity\\nRestart=on-failure\\nUser=root\\nGroup=root\\nFragmentPath=" + shellPath(fragment) + "\\nDropInPaths=\\n'\n", "utf8");
    await chmod(systemctl, 0o755);
    const command = "source " + shellQuote(shellPath(auditFile))
      + "; if systemd_service_json inactive.service '{\"checks\":[],\"state\":\"not-applicable\"}' >/dev/null; then printf unexpected; else printf rejected; fi";
    const result = runBash(command, [root]);
    assert.equal(result.status, 0, `${bad}: ${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, "rejected", bad);
  }

  const reportCommand = "source " + shellQuote(shellPath(auditFile))
    + "; for name in \"\${REQUIRED_PROBES[@]}\"; do probe \"$name\" absent ABSENT null; done"
    + "; probe identity.auditActor ok '' '{\"egid\":0,\"euid\":0,\"supplementaryGids\":[0]}'"
    + "; if value=\"$(systemd_service_json inactive.service '{\"checks\":[],\"state\":\"not-applicable\"}')\"; then probe services.caddy ok '' \"$value\"; else probe services.caddy error SYSTEMD_QUERY_FAILED null; fi"
    + "; emit_report";
  const reportResult = runBash(reportCommand, [root]);
  assert.equal(reportResult.status, 0, reportResult.stdout + "\n" + reportResult.stderr);
  const report = JSON.parse(reportResult.stdout);
  assert.equal(report.complete, false);
  assert.equal(report.probes["services.caddy"].state, "error");
  assert.doesNotThrow(() => validateHostAudit(report));
});

test("systemd service uint64 counters stay lossless decimal strings", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-systemd-counter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fragment = join(root, "sample.service");
  const systemctl = join(root, "systemctl");
  await writeFile(fragment, "[Service]\nExecStart=/bin/true\n", "utf8");
  await writeFile(systemctl, "#!/bin/sh\ncase \"$*\" in\n *LoadState*) printf 'LoadState=loaded\\nActiveState=active\\nSubState=running\\nMainPID=10\\nNRestarts=0\\nMemoryCurrent=9007199254740995\\nCPUUsageNSec=9007199254740993\\nMemoryMax=infinity\\nTasksCurrent=2\\nTasksMax=512\\nCPUQuotaPerSecUSec=infinity\\nRestart=on-failure\\nUser=root\\nGroup=root\\nFragmentPath=" + shellPath(fragment) + "\\nDropInPaths=\\n' ;;\n *) printf 'MemoryCurrent=9007199254740995\\nCPUUsageNSec=9007199254740993\\nTasksCurrent=2\\n' ;;\nesac\n", "utf8");
  await chmod(systemctl, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; service=\"$(systemd_service_json sample.service '{\"checks\":[],\"state\":\"not-applicable\"}')\""
    + "; printf '%s' \"$service\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  const service = JSON.parse(result.stdout);
  assert.equal(service.cpuUsageNSec, "9007199254740993");
  assert.equal(service.memoryCurrent, "9007199254740995");
});

test("candidate rechecks classify loopback and hostile wildcard without emitting addresses", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-listener-hostile-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ss = join(root, "ss");
  await writeFile(
    ss,
    "#!/bin/sh\n"
      + "case \"$*\" in\n"
      + "  *-lntup*) printf 'LISTEN 0 10 127.0.0.1:3000 0.0.0.0:*\\nUNCONN 0 0 0.0.0.0:53 0.0.0.0:*\\n' ;;\n"
      + "  *:3000*) printf 'LISTEN 0 10 127.0.0.1:3000 0.0.0.0:*\\n' ;;\n"
      + "  *:3100*) printf 'LISTEN 0 10 0.0.0.0:3100 0.0.0.0:*\\n' ;;\n"
      + "  *) : ;;\n"
      + "esac\n",
    "utf8",
  );
  await chmod(ss, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_listeners; printf '%s' \"\${PROBE_VALUE[listeners.candidatePorts]}\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  const ports = JSON.parse(result.stdout);
  assert.equal(ports.find((entry) => entry.port === 3000 && entry.addressFamily === "ipv4").loopbackOnly, true);
  assert.equal(ports.find((entry) => entry.port === 3100 && entry.addressFamily === "ipv4").loopbackOnly, false);
  assert.equal(ports.find((entry) => entry.port === 3101 && entry.addressFamily === "ipv4").listenCount, 0);
  assert.doesNotMatch(result.stdout, /127\.0\.0\.1|0\.0\.0\.0/u);
});

test("Caddy root, recursive file imports, and adapter-only syntax evidence are digested without module provisioning", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-caddy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const caddyfile = join(root, "Caddyfile");
  const imported = join(root, "upstreams.caddy");
  const caddy = join(root, "caddy");
  const validateMarker = join(root, "validate-was-invoked");
  await writeFile(caddyfile, "import upstreams.caddy\n(example) {\n respond 200\n}\nimport example\n", "utf8");
  await writeFile(imported, "reverse_proxy 127.0.0.1:3101\n", "utf8");
  await writeFile(caddy, `#!/bin/sh\ncase "$1" in\n adapt) printf '{"apps":{}}\\n' ;;\n validate) printf invoked > ${shellQuote(shellPath(validateMarker))}; exit 91 ;;\n *) exit 97 ;;\nesac\n`, "utf8");
  await chmod(caddy, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_caddy_from_root " + shellQuote(shellPath(caddyfile)) + " " + shellQuote(shellPath(caddy))
    + "; printf '%s\\n%s\\n%s\\n%s' \"\${PROBE_STATE[caddy.root]}\" \"\${PROBE_STATE[caddy.closure]}\" \"\${PROBE_VALUE[caddy.closure]}\" \"\${PROBE_VALUE[caddy.validate]}\"";
  const result = runBash(command);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  const [rootState, closureState, closureRaw, validateRaw] = result.stdout.trim().split("\n");
  assert.equal(rootState, "ok");
  assert.equal(closureState, "ok");
  const closure = JSON.parse(closureRaw);
  assert.equal(closure.complete, true);
  assert.equal(closure.entryCount, 2);
  assert.match(closure.adaptedDigest, /^[a-f0-9]{64}$/u);
  assert.match(closure.digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(Object.keys(closure.entries[0]).sort(), ["digest", "gid", "mode", "nlink", "pathDigest", "realpathDigest", "type", "uid"]);
  assert.doesNotMatch(closureRaw, /upstreams[.]caddy|moawork-audit-caddy-/u);
  assert.deepEqual(JSON.parse(validateRaw), { adapter: "caddyfile", configPath: shellPath(caddyfile), mode: "read-only-adapt", validated: false, validationDigest: closure.adaptedDigest });
  assert.doesNotMatch(result.stdout, /reverse_proxy|127\.0\.0\.1|valid configuration/u);
  await assert.rejects(() => readFile(validateMarker), { code: "ENOENT" });
});

test("Caddy unmanaged digest is byte-exact across final-newline, CR, and managed-comment variants", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-caddy-bytes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const caddyfile = join(root, "Caddyfile");
  const caddy = join(root, "caddy");
  await writeFile(caddy, "#!/bin/sh\nprintf '{\"apps\":{}}\\n'\n", "utf8");
  await chmod(caddy, 0o755);
  const collect = () => {
    const command = "source " + shellQuote(shellPath(auditFile))
      + "; collect_caddy_from_root " + shellQuote(shellPath(caddyfile)) + " " + shellQuote(shellPath(caddy))
      + "; printf '%s' \"\${PROBE_VALUE[caddy.root]}\"";
    const result = runBash(command);
    assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
    return JSON.parse(result.stdout);
  };
  const importLine = `import ${shellPath(join(root, "moawork.caddy"))}`;
  const exactBlock = `\n# Managed MoaWork import. Existing unrelated site blocks remain outside this file.\n${importLine}\n`;

  await writeFile(caddyfile, `example.test {\n respond 200\n}\n${exactBlock}`, "utf8");
  const baseline = collect();
  assert.equal(baseline.endsWithNewline, true);

  await writeFile(caddyfile, `example.test {\n respond 200\n}\r\n${exactBlock}`, "utf8");
  const crVariant = collect();
  assert.notEqual(crVariant.unmanagedDigest, baseline.unmanagedDigest);

  await writeFile(caddyfile, `example.test {\n respond 200\n}\n# Managed MoaWork import (changed).\n${importLine}\n`, "utf8");
  const commentVariant = collect();
  assert.equal(commentVariant.managedImportOccurrences, 1);
  assert.equal(commentVariant.unmanagedDigest, commentVariant.digest);
  assert.notEqual(commentVariant.unmanagedDigest, baseline.unmanagedDigest);

  await writeFile(caddyfile, `example.test {\n respond 200\n}\n${exactBlock.slice(0, -1)}`, "utf8");
  const noFinalNewline = collect();
  assert.equal(noFinalNewline.endsWithNewline, false);
  assert.equal(noFinalNewline.unmanagedDigest, noFinalNewline.digest);
});

test("exact managed Caddy include may be empty only for the reviewed first-install state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-caddy-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const caddyfile = join(root, "Caddyfile");
  const managedInclude = join(root, "moawork.caddy");
  const managedDirectory = join(root, "moawork.d");
  const caddy = join(root, "caddy");
  await mkdir(managedDirectory);
  await writeFile(caddyfile, "import moawork.caddy\n", "utf8");
  await writeFile(managedInclude, "import moawork.d/*.caddy\n", "utf8");
  await writeFile(caddy, "#!/bin/sh\ncase \"$1\" in\n adapt) printf '{\"apps\":{}}\\n' ;;\n validate) exit 91 ;;\n *) exit 97 ;;\nesac\n", "utf8");
  await chmod(caddy, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_caddy_from_root " + shellQuote(shellPath(caddyfile)) + " " + shellQuote(shellPath(caddy))
    + "; printf '%s\\n%s\\n%s' \"\${PROBE_STATE[caddy.closure]}\" \"\${PROBE_VALUE[caddy.closure]}\" \"\${PROBE_STATE[caddy.validate]}\"";
  const result = runBash(command);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  const [closureState, closureRaw, validateState] = result.stdout.trim().split("\n");
  assert.equal(closureState, "ok");
  assert.equal(validateState, "ok");
  const closure = JSON.parse(closureRaw);
  assert.equal(closure.complete, true);
  assert.equal(closure.entryCount, 2);

  await writeFile(join(managedDirectory, "foreign.txt"), "not a route", "utf8");
  await writeFile(managedInclude, "import other/*.caddy\n", "utf8");
  const foreign = runBash(command);
  assert.equal(foreign.status, 0, foreign.stdout + "\n" + foreign.stderr);
  assert.equal(foreign.stdout.trim().split("\n")[0], "error");
});

test("Hermes container names remain local handles and output only opaque digests", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-docker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const docker = join(root, "docker");
  await writeFile(docker, "#!/bin/sh\ncase \"$1\" in\n ps) test \"$2\" = -a || exit 98; printf 'bbb222|hermes-private-b\\naaa111|hermes-private-a\\n' ;;\n inspect) case \"$*\" in *private-a*) printf 'aaa111-full|image-a|exited|none|1|671088640|500000000|128\\n' ;; *) printf 'bbb222-full|image-b|exited|none|1|671088640|500000000|128\\n' ;; esac ;;\n *) exit 97 ;;\nesac\n", "utf8");
  await chmod(docker, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_hermes; printf '%s' \"\${PROBE_VALUE[services.hermes]}\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.containerCount, 2);
  assert.equal(value.containers.length, 2);
  assert.equal(value.containers[0].state, "exited");
  assert.match(value.containers[0].identityDigest, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(result.stdout, /private-a|private-b/u);
});

test("Hermes inspect nonzero is an error even with valid-looking stdout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "moawork-audit-docker-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const docker = join(root, "docker");
  await writeFile(docker, "#!/bin/sh\ncase \"$1\" in\n ps) printf 'aaa111|hermes-private-a\\n' ;;\n inspect) printf 'aaa111-full|image-a|running|healthy|0|1|1|1\\n'; exit 9 ;;\n *) exit 97 ;;\nesac\n", "utf8");
  await chmod(docker, 0o755);
  const command = "source " + shellQuote(shellPath(auditFile))
    + "; collect_hermes; printf '%s|%s' \"\${PROBE_STATE[services.hermes]}\" \"\${PROBE_REASON[services.hermes]}\"";
  const result = runBash(command, [root]);
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.equal(result.stdout, "error|HERMES_INSPECT_FAILED");
});
