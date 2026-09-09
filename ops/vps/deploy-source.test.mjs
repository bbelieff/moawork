import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./deploy-source.sh", import.meta.url));
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const posix = (s) => process.platform === "win32" ? s.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, d) => "/" + d.toLowerCase()) : s;
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
function run(body) {
  return spawnSync(bash, ["--noprofile", "--norc", "-c", "source " + quote(posix(script)) + "; " + body],
    { encoding: "utf8", timeout: 10000, windowsHide: true });
}
const setup = `
ROOT=/fixture
events=""
set_current() { events+="switch:$1 "; current="$1"; }
systemctl() { events+="$1:$2 "; return 0; }
ln() { events+="previous-link "; }
mv() { events+="previous-commit "; }
rm() { events+="remove-current "; }
`;
test("direct deploy shell parses without invoking any host command", () => {
  const result = spawnSync(bash, ["-n", posix(script)], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
test("healthy candidate is activated before previous link is committed", () => {
  const r = run(setup + `
check_release() { events+="health:$1 "; return 0; }
activate /fixture/releases/new /fixture/releases/old
printf '%s' "$events"
`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "switch:/fixture/releases/new restart:moawork-direct.service health:/fixture/releases/new previous-link previous-commit ");
});
test("failed candidate restores and verifies the previous release", () => {
  const r = run(setup + `
check_release() { events+="health:$1 "; [[ "$1" == /fixture/releases/old ]]; }
if activate /fixture/releases/new /fixture/releases/old; then exit 91; else code=$?; fi
printf '%s|%s' "$code" "$events"
`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "1|switch:/fixture/releases/new restart:moawork-direct.service health:/fixture/releases/new switch:/fixture/releases/old restart:moawork-direct.service health:/fixture/releases/old ");
});
test("first deploy failure stops only the MoaWork candidate and clears current", () => {
  const r = run(setup + `
check_release() { return 1; }
if activate /fixture/releases/new ""; then exit 91; else code=$?; fi
printf '%s|%s' "$code" "$events"
`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "1|switch:/fixture/releases/new restart:moawork-direct.service stop:moawork-direct.service remove-current ");
});
test("failed recovery is distinct from a successful rollback", () => {
  const r = run(setup + `
check_release() { return 1; }
if activate /fixture/releases/new /fixture/releases/old; then exit 91; else printf '%s' "$?"; fi
`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "2");
  assert.match(r.stderr, /ROLLBACK_FAILED/);
});
test("ready verifier rejects stale SHA, wrong artifact, and unverified key even with HTTP success", () => {
  const sha = "a".repeat(40), artifact = "b".repeat(64);
  const valid = { service: "moawork-web", status: "ready", runtime: "self-hosted", buildSha: sha, releaseSha: sha,
    artifactSha256: artifact, revision: "verified", configuration: "verified", artifact: "verified",
    serverActions: "verified", analytics: "configured" };
  for (const [change, expected] of [[{}, 0], [{ analytics: "disabled" }, 0], [{ analytics: "unknown" }, 1], [{ buildSha: "c".repeat(40) }, 1],
    [{ artifactSha256: "d".repeat(64) }, 1], [{ serverActions: "unverified" }, 1]]) {
    const body = JSON.stringify({ ...valid, ...change });
    const r = run("NODE=" + quote(posix(process.execPath)) + "; curl() { printf '%s' " + quote(body)
      + "; }; check_ready " + sha + " " + artifact);
    assert.equal(r.status, expected, r.stderr);
  }
});

test("port query failure cannot be reported as an unused port", () => {
  for (const [body, expected] of [["return 0", 0], ["printf occupied", 1], ["return 1", 1]]) {
    const r = run("ss() { " + body + "; }; port_free");
    assert.equal(r.status, expected, r.stderr);
  }
});
