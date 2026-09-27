import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./deploy-source.sh", import.meta.url));
const scriptSource = readFileSync(script, "utf8");
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
test("observer is copied before hashing, made runtime-readonly, and required only by the candidate release", () => {
  const installed = scriptSource.indexOf("install_observer \"$release/source/$OBSERVER_SOURCE_RELATIVE\"");
  const owned = scriptSource.indexOf("chown -hR root:moawork \"$release/runtime\"");
  const readonly = scriptSource.indexOf("chmod -R u=rwX,g=rX,o= \"$release/runtime\"");
  const hashed = scriptSource.indexOf("tar --sort=name");
  assert.ok(installed > 0 && installed < owned && owned < readonly && readonly < hashed);
  assert.match(scriptSource, /\[\[ -f \"\$source\" && ! -L \"\$source\" \]\]/);
  assert.match(scriptSource, /NODE_OPTIONS=--require=%s/);
  assert.match(scriptSource, /OBSERVER_REQUIRE_PATH=\$ROOT\/current\/runtime\/app\/\$OBSERVER_RUNTIME_NAME/);
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

test("observer install accepts one regular source and rejects missing, linked, or occupied paths", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX ownership boundary is exercised by Linux CI");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "moawork-observer-"));
  const source = join(directory, "observer.cjs");
  const linked = join(directory, "linked.cjs");
  const target = join(directory, "target.cjs");
  const second = join(directory, "second.cjs");
  const create = spawnSync("/bin/sh", ["-c", `printf safe >${quote(source)}`], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);
  symlinkSync(source, linked);

  const first = run(`install_observer ${quote(source)} ${quote(target)}`);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(target, "utf8"), "safe");
  assert.notEqual(run(`install_observer ${quote(source)} ${quote(target)}`).status, 0);
  assert.notEqual(run(`install_observer ${quote(linked)} ${quote(second)}`).status, 0);
  assert.notEqual(run(`install_observer ${quote(join(directory, "missing.cjs"))} ${quote(second)}`).status, 0);
});

test("release environment binds the root-controlled preload without affecting legacy rollback", () => {
  const directory = mkdtempSync(join(tmpdir(), "moawork-release-env-"));
  const target = join(directory, "release.env");
  const sha = "a".repeat(40);
  const artifact = "b".repeat(64);
  const result = run(`write_release_env ${quote(posix(target))} ${sha} ${artifact}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(target, "utf8"), [
    "NODE_ENV=production",
    "HOSTNAME=127.0.0.1",
    "PORT=3100",
    `MOAWORK_BUILD_SHA=${sha}`,
    `MOAWORK_RELEASE_SHA=${sha}`,
    `MOAWORK_ARTIFACT_SHA256=${artifact}`,
    "NODE_OPTIONS=--require=/srv/moawork-direct/current/runtime/app/request-stream-observer.cjs",
    "",
  ].join("\n"));

  const legacy = run(setup + `
check_release() { events+="health:$1 "; [[ "$1" == /fixture/releases/legacy-without-observer ]]; }
if activate /fixture/releases/new /fixture/releases/legacy-without-observer; then exit 91; else code=$?; fi
printf '%s|%s' "$code" "$events"
`);
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.match(legacy.stdout, /^1\|/);
  assert.match(legacy.stdout, /health:\/fixture\/releases\/legacy-without-observer/);
});

test("retention runs after the current release is verified and before the new build", () => {
  const health = scriptSource.indexOf("check_release \"$previous\" || die 'existing MoaWork release is not healthy'");
  const prune = scriptSource.indexOf("prune_releases \"$KEEP_RELEASES\" \"$previous\" \"$(release_link \"$ROOT/previous\")\" \"$release\"");
  const build = scriptSource.indexOf("install -d -m 0755 \"$release\"");
  assert.ok(health > 0 && health < prune && prune < build);
  assert.match(scriptSource, /^KEEP_RELEASES=3$/m);
});

function retentionFixture() {
  const root = posix(mkdtempSync(join(tmpdir(), "moawork-retention-")));
  const shas = Array.from({ length: 7 }, (_, i) => String(i + 1).repeat(40));
  const body = `ROOT=${quote(root)}; mkdir -p "$ROOT/releases" "$ROOT/incoming" "$ROOT/releases/scratch"
n=1000; for s in ${shas.join(" ")}; do
  [[ $s == ${shas[6]} ]] || { mkdir "$ROOT/releases/$s"; touch -d @$n "$ROOT/releases/$s"; }
  : >"$ROOT/incoming/$s.tar"; n=$((n+100)); done
: >"$ROOT/incoming/notes.tar"; : >"$ROOT/incoming/${"8".repeat(40)}.tar"
`;
  return { root, shas, body, rel: (i) => `${root}/releases/${shas[i]}` };
}
const listing = `; printf '%s|' $(ls "$ROOT/releases"); printf '#'; printf '%s|' $(ls "$ROOT/incoming")`;

test("retention keeps current, previous and the newest extras, and drops only the pruned releases' archives", () => {
  const f = retentionFixture();
  // current = newest (6), previous = oldest (1), candidate 7 is not built yet.
  const r = run(f.body + `prune_releases 3 ${quote(f.rel(5))} ${quote(f.rel(0))} ${quote(f.rel(6))}` + listing);
  assert.equal(r.status, 0, r.stderr);
  const [out, listed] = [r.stdout.split("\n").filter((l) => l.startsWith("PRUNED")), r.stdout.split("\n").pop()];
  assert.deepEqual(out, [3, 2, 1].map((i) => "PRUNED release=" + f.shas[i]));
  const [releases, incoming] = listed.split("#");
  assert.deepEqual(releases.split("|").filter(Boolean).sort(), [f.shas[0], f.shas[4], f.shas[5], "scratch"].sort());
  assert.deepEqual(incoming.split("|").filter(Boolean).sort(),
    [f.shas[0], f.shas[4], f.shas[5], f.shas[6], "8".repeat(40)].map((s) => s + ".tar").concat("notes.tar").sort());
});

test("retention never deletes protected releases even when keep is smaller than the protected set", () => {
  const f = retentionFixture();
  const r = run(f.body + `prune_releases 1 ${quote(f.rel(5))} ${quote(f.rel(0))} ""` + listing);
  assert.equal(r.status, 0, r.stderr);
  const [releases] = r.stdout.split("\n").pop().split("#");
  assert.deepEqual(releases.split("|").filter(Boolean).sort(), [f.shas[0], f.shas[5], "scratch"].sort());
});

test("retention refuses protected paths outside the release root and invalid keep counts", () => {
  for (const call of [(f) => `prune_releases 3 /tmp/elsewhere`, (f) => `prune_releases 0 ${quote(f.rel(5))}`, () => `prune_releases x`]) {
    const f = retentionFixture();
    const r = run(f.body + `if ${call(f)}; then printf accepted; else printf refused; fi` + listing);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^refused/);
    assert.doesNotMatch(r.stdout, /PRUNED/);
    assert.equal(r.stdout.split("#")[0].split("|").filter(Boolean).length, 7);
  }
});
