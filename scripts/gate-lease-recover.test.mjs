import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MODULE = fileURLToPath(new URL("./gate-lease-recovery-core.psm1", import.meta.url));
const CLI = fileURLToPath(new URL("./gate-lease-recover.ps1", import.meta.url));
const LAUNCHER = fileURLToPath(new URL("./gate-lease-recover.mjs", import.meta.url));
const GUARDIAN = fileURLToPath(new URL("./gate-lease-guardian.ps1", import.meta.url));
const POWERSHELL = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPowerShell(body) {
  const script = `
$ErrorActionPreference = "Stop"
Import-Module ${psQuote(MODULE)} -Force
$module = Get-Module gate-lease-recovery-core
try {
  $result = & $module {
    ${body}
  }
  [Console]::Out.WriteLine("RESULT " + ($result | ConvertTo-Json -Compress -Depth 10))
  exit 0
} catch {
  [Console]::Error.WriteLine("ERROR " + [string]$_.Exception.Message)
  exit 78
}`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return spawnSync(POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function parseResult(run) {
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const line = run.stdout.split(/\r?\n/u).find((entry) => entry.startsWith("RESULT "));
  assert.ok(line, run.stdout);
  return JSON.parse(line.slice("RESULT ".length));
}

function fixture(body, { weakAcl = false, port = 0 } = {}) {
  const id = randomUUID().replaceAll("-", "");
  return runPowerShell(`
$sub = "Software\\MoaWork\\GateLeaseRecoveryTest\\${id}"
$fence = "Global\\MoaWork.FullGate.RecoveryTest.${id}"
$valueName = Get-GateLeaseRecoveryValueName $fence
$boot = Get-GateLeaseRecoveryBootIdentity
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$deadPid = [uint32]4000000000
$creation = [int64]123456789
$createdAt = "2026-08-28T00:00:00.0000000+00:00"
function New-V1Raw([uint32]$GuardianPid = $deadPid, [int64]$GuardianCreation = $creation) {
  return ([ordered]@{ version = 1; guardianPid = $GuardianPid; guardianCreationIdentity = $GuardianCreation; ownerSid = $sid; bootIdentity = $boot; fenceName = $fence; createdAt = $createdAt } | ConvertTo-Json -Compress)
}
function Invoke-Exact([string]$Raw, [hashtable]$Extra = @{}) {
  $invoke = @{
    ExpectedRawDigest = Get-GateLeaseRecoverySha256 $Raw
    ExpectedBootIdentity = $boot
    ExpectedOwnerSid = $sid
    ExpectedGuardianPid = [uint32](($Raw | ConvertFrom-Json).guardianPid)
    ExpectedGuardianCreationIdentity = if (($Raw | ConvertFrom-Json).PSObject.Properties.Name -contains "guardianCreationIdentity") { [int64](($Raw | ConvertFrom-Json).guardianCreationIdentity) } else { 0 }
    ExpectedFenceName = $fence
    ExpectedValueName = $valueName
    InternalRegistrySubKey = $sub
    InternalFenceName = $fence
    InternalPort = ${port}
  }
  foreach ($entry in $Extra.GetEnumerator()) { $invoke[$entry.Key] = $entry.Value }
  return Invoke-GateLeaseRecoveryInternal @invoke
}
try {
  ${body}
} finally {
  Remove-GateLeaseRecoveryFixture $sub
}`);
}

test("production recovery CLI exposes no registry, fence, or port injection", { skip: process.platform !== "win32" }, () => {
  const run = runPowerShell(`
$parameters = (Get-Command ${psQuote(CLI)}).Parameters.Keys
[pscustomobject]@{ internal = @($parameters | Where-Object { $_ -match "Internal|Registry|Port" }); hasDryRun = $parameters -contains "DryRun" }`);
  const result = parseResult(run);
  assert.deepEqual(result.internal, []);
  assert.equal(result.hasDryRun, true);
});

test("production launcher pins Windows PowerShell 5.1 and direct pwsh fails structured before recovery", { skip: process.platform !== "win32" }, () => {
  const common = [
    "-ExpectedRawDigest", "bad",
    "-ExpectedBootIdentity", "not-a-boot",
    "-ExpectedOwnerSid", "not-a-sid",
    "-ExpectedGuardianPid", "1",
    "-ExpectedFenceName", "Global\\MoaWork.FullGate.v1",
    "-ExpectedValueName", "0".repeat(64),
    "-DryRun",
  ];
  const canonical = spawnSync(process.execPath, [LAUNCHER, ...common], { encoding: "utf8", windowsHide: true });
  assert.equal(canonical.status, 78, `${canonical.stdout}${canonical.stderr}`);
  assert.match(`${canonical.stdout}${canonical.stderr}`, /RECOVERY_DIGEST_INVALID/u);
  assert.doesNotMatch(`${canonical.stdout}${canonical.stderr}`, /RECOVERY_POWERSHELL_UNSUPPORTED|SetAccessControl/u);

  const unsupported = spawnSync("pwsh.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", CLI, ...common], { encoding: "utf8", windowsHide: true });
  assert.equal(unsupported.status, 78, `${unsupported.stdout}${unsupported.stderr}`);
  assert.match(`${unsupported.stdout}${unsupported.stderr}`, /RECOVERY_POWERSHELL_UNSUPPORTED/u);
  assert.doesNotMatch(`${unsupported.stdout}${unsupported.stderr}`, /SetAccessControl|RECOVERY_DIGEST_INVALID/u);
});

test("future guardian marker is v1, owner-only, and gains command identity after start", () => {
  const guardian = readFileSync(GUARDIAN, "utf8");
  assert.match(guardian, /SetAccessRuleProtection\(\$true, \$false\)/u);
  for (const field of ["version = 1", "guardianCreationIdentity", "ownerSid", "bootIdentity", "fenceName", "createdAt", "commandPid", "commandCreationIdentity", "jobActiveProcesses"]) {
    assert.match(guardian, new RegExp(field, "u"));
  }
  assert.match(guardian, /Set-FenceMarker \(\[string\]\$payload\.fenceName\) \$job \$markerCreatedAt/u);
  assert.match(guardian, /receipt\.result -eq "prepared"[\s\S]*Quarantine "recovery-incomplete"/u);
  assert.match(guardian, /Global\\MoaWork\.FullGate\.Test\.[\s\S]*Software\\MoaWork\\GateLeaseTest/u);
});

test("v1 stale owner clears exactly once and writes owner-only durable audit", { skip: process.platform !== "win32" }, () => {
  const run = fixture(`
$raw = New-V1Raw
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$cleared = Invoke-Exact $raw
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
$replay = ""
try { [void](Invoke-Exact $raw) } catch { $replay = [string]$_.Exception.Message }
[pscustomobject]@{ cleared = $cleared.cleared; markerExists = $state.markerExists; aclStrict = $state.aclStrict; auditCount = $state.auditCount; auditAclStrict = $state.auditAclStrict; audit = ($state.auditRaw | ConvertFrom-Json); replay = $replay }`);
  const result = parseResult(run);
  assert.equal(result.cleared, true);
  assert.equal(result.markerExists, false);
  assert.equal(result.aclStrict, true);
  assert.equal(result.auditCount, 1);
  assert.equal(result.auditAclStrict, true);
  assert.equal(result.audit.result, "cleared");
  assert.equal(result.replay, "RECOVERY_MARKER_MISSING");
});

test("dry-run authenticates but never clears or audits", { skip: process.platform !== "win32" }, () => {
  const run = fixture(`
$raw = New-V1Raw
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$result = Invoke-Exact $raw @{ DryRun = $true }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ cleared = $result.cleared; wouldClear = $result.wouldClear; markerExists = $state.markerExists; auditCount = $state.auditCount }`);
  assert.deepEqual(parseResult(run), { cleared: false, wouldClear: true, markerExists: true, auditCount: 0 });
});

test("audit failure restores the exact marker and leaves a durable rollback receipt", { skip: process.platform !== "win32" }, () => {
  const run = fixture(`
$raw = New-V1Raw
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-Exact $raw @{ InternalAfterDelete = { throw "INJECT_AUDIT_FAILURE" } }) } catch { $code = [string]$_.Exception.Message }
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($sub, $false)
try { $restored = [string]$key.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Dispose() }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; exactRestored = $restored -ceq $raw; markerExists = $state.markerExists; auditCount = $state.auditCount; auditResult = ($state.auditRaw | ConvertFrom-Json).result }`);
  assert.deepEqual(parseResult(run), { code: "RECOVERY_AUDIT_WRITE_FAILED", exactRestored: true, markerExists: true, auditCount: 1, auditResult: "rolled-back" });
});

test("live exact v1 owner is rejected without mutation", { skip: process.platform !== "win32" }, () => {
  const run = fixture(`
$liveCreation = Get-GateLeaseRecoveryProcessIdentity ([uint32]$PID)
$raw = New-V1Raw ([uint32]$PID) $liveCreation
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-Exact $raw) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists; auditCount = $state.auditCount }`);
  assert.deepEqual(parseResult(run), { code: "RECOVERY_OWNER_LIVE", markerExists: true, auditCount: 0 });
});

test("digest mismatch, partial v1, and atomic reread race all clear zero", { skip: process.platform !== "win32" }, () => {
  const mismatch = fixture(`
$raw = New-V1Raw
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-GateLeaseRecoveryInternal -ExpectedRawDigest ("0" * 64) -ExpectedBootIdentity $boot -ExpectedOwnerSid $sid -ExpectedGuardianPid $deadPid -ExpectedGuardianCreationIdentity $creation -ExpectedFenceName $fence -ExpectedValueName $valueName -InternalRegistrySubKey $sub -InternalFenceName $fence -InternalPort 0) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists }`);
  assert.deepEqual(parseResult(mismatch), { code: "RECOVERY_DIGEST_MISMATCH", markerExists: true });

  const partial = fixture(`
$raw = ([ordered]@{ version = 1; guardianPid = $deadPid; guardianCreationIdentity = $creation; ownerSid = $sid; bootIdentity = $boot; fenceName = $fence } | ConvertTo-Json -Compress)
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-Exact $raw) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists }`);
  assert.deepEqual(parseResult(partial), { code: "RECOVERY_MARKER_V1_SCHEMA_INVALID", markerExists: true });

  const race = fixture(`
$raw = New-V1Raw
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$replacement = (New-V1Raw $deadPid ($creation + 1))
$hook = {
  $raceKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($sub, $true)
  try { $raceKey.SetValue($valueName, $replacement, [Microsoft.Win32.RegistryValueKind]::String); $raceKey.Flush() } finally { $raceKey.Dispose() }
}
$code = ""
try { [void](Invoke-Exact $raw @{ InternalBeforeAtomicRead = $hook }) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists; auditCount = $state.auditCount }`);
  assert.deepEqual(parseResult(race), { code: "RECOVERY_DIGEST_MISMATCH", markerExists: true, auditCount: 0 });
});

test("only runtime integral integer version 1 is v1; every other present version clears zero", { skip: process.platform !== "win32" }, () => {
  const versions = fixture(`
$cases = @(
  [pscustomobject]@{ name = "decimal"; literal = "1.1" },
  [pscustomobject]@{ name = "string"; literal = '\"1\"' },
  [pscustomobject]@{ name = "boolean"; literal = "true" },
  [pscustomobject]@{ name = "scientific"; literal = "1e0" },
  [pscustomobject]@{ name = "two"; literal = "2" },
  [pscustomobject]@{ name = "zero"; literal = "0" },
  [pscustomobject]@{ name = "null"; literal = "null" },
  [pscustomobject]@{ name = "nan"; literal = "NaN" },
  [pscustomobject]@{ name = "positiveInfinity"; literal = "Infinity" },
  [pscustomobject]@{ name = "negativeInfinity"; literal = "-Infinity" }
)
$results = @()
foreach ($case in $cases) {
  $template = ([ordered]@{ version = 0; guardianPid = $deadPid; guardianCreationIdentity = $creation; ownerSid = $sid; bootIdentity = $boot; fenceName = $fence; createdAt = $createdAt } | ConvertTo-Json -Compress)
  $raw = $template -replace '"version":0', ('"version":' + $case.literal)
  New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
  $code = ""
  try {
    [void](Invoke-GateLeaseRecoveryInternal -ExpectedRawDigest (Get-GateLeaseRecoverySha256 $raw) -ExpectedBootIdentity $boot -ExpectedOwnerSid $sid -ExpectedGuardianPid $deadPid -ExpectedGuardianCreationIdentity $creation -ExpectedFenceName $fence -ExpectedValueName $valueName -LegacyBreakGlass -InternalRegistrySubKey $sub -InternalFenceName $fence -InternalPort 0)
  } catch { $code = [string]$_.Exception.Message }
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($sub, $false)
  try { $stored = [string]$key.GetValue($valueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Dispose() }
  $state = Get-GateLeaseRecoveryFixtureState $sub $fence
  $results += [pscustomobject]@{ name = $case.name; code = $code; unchanged = $stored -ceq $raw; markerExists = $state.markerExists; auditCount = $state.auditCount }
  Remove-GateLeaseRecoveryFixture $sub
}
$validRaw = New-V1Raw
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $validRaw
$valid = Invoke-Exact $validRaw @{ DryRun = $true }
[pscustomobject]@{ invalid = $results; validWouldClear = $valid.wouldClear; validCleared = $valid.cleared }`);
  const result = parseResult(versions);
  assert.equal(result.validWouldClear, true);
  assert.equal(result.validCleared, false);
  for (const item of result.invalid) {
    assert.ok(["RECOVERY_MARKER_VERSION_UNSUPPORTED", "RECOVERY_MARKER_MALFORMED"].includes(item.code), JSON.stringify(item));
    assert.equal(item.unchanged, true, item.name);
    assert.equal(item.markerExists, true, item.name);
    assert.equal(item.auditCount, 0, item.name);
  }
});

test("v1 and legacy schemas reject unexpected or wrongly typed fields", { skip: process.platform !== "win32" }, () => {
  const unknown = fixture(`
$raw = ([ordered]@{ version = 1; guardianPid = $deadPid; guardianCreationIdentity = $creation; ownerSid = $sid; bootIdentity = $boot; fenceName = $fence; createdAt = $createdAt; unexpected = "no" } | ConvertTo-Json -Compress)
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-Exact $raw) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists; auditCount = $state.auditCount }`);
  assert.deepEqual(parseResult(unknown), { code: "RECOVERY_MARKER_V1_SCHEMA_INVALID", markerExists: true, auditCount: 0 });

  const wrongV1Type = fixture(`
$raw = ([ordered]@{ version = 1; guardianPid = [string]$deadPid; guardianCreationIdentity = $creation; ownerSid = $sid; bootIdentity = $boot; fenceName = $fence; createdAt = $createdAt } | ConvertTo-Json -Compress)
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-GateLeaseRecoveryInternal -ExpectedRawDigest (Get-GateLeaseRecoverySha256 $raw) -ExpectedBootIdentity $boot -ExpectedOwnerSid $sid -ExpectedGuardianPid $deadPid -ExpectedGuardianCreationIdentity $creation -ExpectedFenceName $fence -ExpectedValueName $valueName -InternalRegistrySubKey $sub -InternalFenceName $fence -InternalPort 0) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists; auditCount = $state.auditCount }`);
  assert.deepEqual(parseResult(wrongV1Type), { code: "RECOVERY_MARKER_V1_TYPE_INVALID", markerExists: true, auditCount: 0 });

  const partialOptional = fixture(`
$raw = ([ordered]@{ version = 1; guardianPid = $deadPid; guardianCreationIdentity = $creation; ownerSid = $sid; bootIdentity = $boot; fenceName = $fence; createdAt = $createdAt; commandPid = 123 } | ConvertTo-Json -Compress)
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-Exact $raw) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists; auditCount = $state.auditCount }`);
  assert.deepEqual(parseResult(partialOptional), { code: "RECOVERY_MARKER_V1_SCHEMA_INVALID", markerExists: true, auditCount: 0 });

  const legacyExtra = fixture(`
$raw = ([ordered]@{ guardianPid = $deadPid; bootIdentity = $boot; fenceName = $fence; unexpected = "no" } | ConvertTo-Json -Compress)
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-Exact $raw @{ LegacyBreakGlass = $true }) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists }`);
  assert.deepEqual(parseResult(legacyExtra), { code: "RECOVERY_LEGACY_SCHEMA_INVALID", markerExists: true });

  const legacyType = fixture(`
$raw = ([ordered]@{ guardianPid = [string]$deadPid; bootIdentity = $boot; fenceName = $fence } | ConvertTo-Json -Compress)
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-GateLeaseRecoveryInternal -ExpectedRawDigest (Get-GateLeaseRecoverySha256 $raw) -ExpectedBootIdentity $boot -ExpectedOwnerSid $sid -ExpectedGuardianPid $deadPid -ExpectedGuardianCreationIdentity 0 -ExpectedFenceName $fence -ExpectedValueName $valueName -LegacyBreakGlass -InternalRegistrySubKey $sub -InternalFenceName $fence -InternalPort 0) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists; auditCount = $state.auditCount }`);
  assert.deepEqual(parseResult(legacyType), { code: "RECOVERY_LEGACY_TYPE_INVALID", markerExists: true, auditCount: 0 });
});

test("weak ACL v1 rejects; exact legacy needs flag then hardens, clears, and audits", { skip: process.platform !== "win32" }, () => {
  const weak = fixture(`
$raw = New-V1Raw
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw -WeakAcl
$code = ""
try { [void](Invoke-Exact $raw) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists; aclStrict = $state.aclStrict }`, { weakAcl: true });
  assert.deepEqual(parseResult(weak), { code: "RECOVERY_REGISTRY_ACL_INVALID", markerExists: true, aclStrict: false });

  const legacy = fixture(`
$raw = (@{ guardianPid = $deadPid; bootIdentity = $boot; fenceName = $fence } | ConvertTo-Json -Compress)
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw -WeakAcl
$absent = ""
try { [void](Invoke-Exact $raw) } catch { $absent = [string]$_.Exception.Message }
$result = Invoke-Exact $raw @{ LegacyBreakGlass = $true }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ absent = $absent; cleared = $result.cleared; markerExists = $state.markerExists; aclStrict = $state.aclStrict; auditCount = $state.auditCount; auditAclStrict = $state.auditAclStrict }`, { weakAcl: true });
  assert.deepEqual(parseResult(legacy), { absent: "RECOVERY_LEGACY_BREAK_GLASS_REQUIRED", cleared: true, markerExists: false, aclStrict: true, auditCount: 1, auditAclStrict: true });
});

test("listener and relevant gate process each block clearing", { skip: process.platform !== "win32" }, async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  try {
    const port = server.address().port;
    const listener = fixture(`
$raw = New-V1Raw
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-Exact $raw) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists }`, { port });
    assert.deepEqual(parseResult(listener), { code: "RECOVERY_LISTENER_LIVE", markerExists: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const decoy = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", "gate-lease-guardian.ps1"], { stdio: "ignore", windowsHide: true });
  try {
    const processRun = fixture(`
$raw = New-V1Raw
New-GateLeaseRecoveryFixture -RegistrySubKey $sub -FenceName $fence -Raw $raw
$code = ""
try { [void](Invoke-Exact $raw) } catch { $code = [string]$_.Exception.Message }
$state = Get-GateLeaseRecoveryFixtureState $sub $fence
[pscustomobject]@{ code = $code; markerExists = $state.markerExists }`);
    assert.deepEqual(parseResult(processRun), { code: "RECOVERY_GATE_PROCESS_LIVE", markerExists: true });
  } finally {
    decoy.kill("SIGKILL");
  }
});
