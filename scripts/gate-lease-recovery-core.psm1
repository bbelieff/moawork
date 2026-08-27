Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not ("MoaWorkGateRecoveryNative" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class MoaWorkGateRecoveryNative {
  const uint SYNCHRONIZE = 0x00100000;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x00001000;
  [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint Low; public uint High; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern ulong GetTickCount64();

  public static long? ProcessCreationIdentity(uint processId) {
    IntPtr handle = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
    if (handle == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      if (error == 87 || error == 1168) return null;
      throw new Win32Exception(error, "OpenProcess recovery probe failed");
    }
    try {
      FILETIME creation, exit, kernel, user;
      if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error(), "GetProcessTimes recovery probe failed");
      return ((long)creation.High << 32) | creation.Low;
    } finally { CloseHandle(handle); }
  }

  public static string BootIdentity() {
    long bootTicks = DateTime.UtcNow.Ticks - (long)GetTickCount64() * TimeSpan.TicksPerMillisecond;
    bootTicks -= bootTicks % TimeSpan.TicksPerMinute;
    return Environment.MachineName + ":" + bootTicks.ToString("x");
  }
}
'@
}

function Get-GateLeaseRecoverySha256([string]$Value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function Get-GateLeaseRecoveryValueName([string]$FenceName) {
  return (Get-GateLeaseRecoverySha256 $FenceName).ToUpperInvariant()
}

function Get-GateLeaseRecoveryBootIdentity() { return [MoaWorkGateRecoveryNative]::BootIdentity() }
function Get-GateLeaseRecoveryProcessIdentity([uint32]$ProcessId) { return [MoaWorkGateRecoveryNative]::ProcessCreationIdentity($ProcessId) }
function Get-CurrentSid() { return [Security.Principal.WindowsIdentity]::GetCurrent().User }

function Set-OwnerOnlyRegistryAcl([Microsoft.Win32.RegistryKey]$Key) {
  $sid = Get-CurrentSid
  $security = [Security.AccessControl.RegistrySecurity]::new()
  $security.SetOwner($sid)
  $security.SetAccessRuleProtection($true, $false)
  $rule = [Security.AccessControl.RegistryAccessRule]::new(
    $sid,
    [Security.AccessControl.RegistryRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]::ContainerInherit,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void]$security.AddAccessRule($rule)
  $Key.SetAccessControl($security)
}

function Test-OwnerOnlyRegistryAcl([Microsoft.Win32.RegistryKey]$Key) {
  $sid = Get-CurrentSid
  $sections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner -bor [Security.AccessControl.AccessControlSections]::Group
  $security = $Key.GetAccessControl($sections)
  if (-not $security.AreAccessRulesProtected) { return $false }
  if ($security.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { return $false }
  $rules = @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 1) { return $false }
  $rule = $rules[0]
  return $rule.IdentityReference.Value -eq $sid.Value -and
    $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
    (($rule.RegistryRights -band [Security.AccessControl.RegistryRights]::FullControl) -eq [Security.AccessControl.RegistryRights]::FullControl) -and
    -not $rule.IsInherited
}

function Set-OwnerOnlyMutexAcl([Threading.Mutex]$Mutex) {
  $sid = Get-CurrentSid
  $security = [Security.AccessControl.MutexSecurity]::new()
  $security.SetOwner($sid)
  $security.SetAccessRuleProtection($true, $false)
  [void]$security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new(
    $sid,
    [Security.AccessControl.MutexRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  $Mutex.SetAccessControl($security)
}

function Test-OwnerOnlyMutexAcl([Threading.Mutex]$Mutex) {
  $sid = Get-CurrentSid
  $security = $Mutex.GetAccessControl()
  if (-not $security.AreAccessRulesProtected) { return $false }
  if ($security.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { return $false }
  $rules = @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  return $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $sid.Value -and -not $rules[0].IsInherited
}

function Open-RecoveryMutex([string]$FenceName) {
  if (-not $FenceName.StartsWith("Global\MoaWork.FullGate.")) { throw "RECOVERY_FENCE_INVALID" }
  $created = $false
  $mutex = [Threading.Mutex]::new($false, $FenceName, [ref]$created)
  if ($created) { Set-OwnerOnlyMutexAcl $mutex }
  elseif (-not (Test-OwnerOnlyMutexAcl $mutex)) { $mutex.Dispose(); throw "RECOVERY_FENCE_ACL_INVALID" }
  return $mutex
}

function Test-RelevantGateProcesses {
  $pattern = 'gate-lease-(guardian|runner|broker|test-harness)(?:\.mjs|\.ps1)?|scripts[\\/]gate-lease\.mjs'
  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match $pattern
  })
  return $processes
}

function Test-GateListener([int]$Port) {
  if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { throw "RECOVERY_LISTENER_PROBE_UNAVAILABLE" }
  return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Test-JsonIntegralType($Value) {
  return $Value -is [int32] -or $Value -is [int64]
}

function Test-ExactPropertySet($Marker, [string[]]$Allowed, [string[]]$Required) {
  $actual = @($Marker.PSObject.Properties.Name)
  foreach ($name in $Required) { if ($actual -notcontains $name) { return $false } }
  foreach ($name in $actual) { if ($Allowed -notcontains $name) { return $false } }
  return $true
}

function New-GateLeaseRecoveryFixture {
  param([string]$RegistrySubKey, [string]$FenceName, [string]$Raw, [switch]$WeakAcl)
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($RegistrySubKey, $true)
  try {
    if (-not $WeakAcl) { Set-OwnerOnlyRegistryAcl $key }
    $key.SetValue((Get-GateLeaseRecoveryValueName $FenceName), $Raw, [Microsoft.Win32.RegistryValueKind]::String)
  } finally { $key.Dispose() }
}

function Remove-GateLeaseRecoveryFixture([string]$RegistrySubKey) {
  try { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($RegistrySubKey, $false) } catch {}
  $testRoot = "Software\MoaWork\GateLeaseRecoveryTest"
  if ($RegistrySubKey.StartsWith($testRoot + "\", [StringComparison]::Ordinal)) {
    $parent = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($testRoot, $false)
    try {
      $empty = $null -ne $parent -and @($parent.GetSubKeyNames()).Count -eq 0 -and @($parent.GetValueNames()).Count -eq 0
    } finally { if ($null -ne $parent) { $parent.Dispose() } }
    if ($empty) { try { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($testRoot, $false) } catch {} }
  }
}

function Get-GateLeaseRecoveryFixtureState {
  param([string]$RegistrySubKey, [string]$FenceName)
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($RegistrySubKey, $false)
  if ($null -eq $key) { return [pscustomobject]@{ keyExists = $false; markerExists = $false; aclStrict = $false; auditCount = 0; auditAclStrict = $false; auditRaw = $null } }
  try {
    $marker = $key.GetValue((Get-GateLeaseRecoveryValueName $FenceName), $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $audit = $key.OpenSubKey("RecoveryAudit", $false)
    try {
      $auditNames = @()
      if ($null -ne $audit) { $auditNames = @($audit.GetValueNames()) }
      $auditCount = $auditNames.Count
      $auditAclStrict = $null -ne $audit -and (Test-OwnerOnlyRegistryAcl $audit)
      $auditRaw = if ($auditCount -eq 0) { $null } else { [string]$audit.GetValue($auditNames[-1], $null) }
    }
    finally { if ($null -ne $audit) { $audit.Dispose() } }
    return [pscustomobject]@{ keyExists = $true; markerExists = $null -ne $marker; aclStrict = Test-OwnerOnlyRegistryAcl $key; auditCount = $auditCount; auditAclStrict = $auditAclStrict; auditRaw = $auditRaw }
  } finally { $key.Dispose() }
}

function Invoke-GateLeaseRecoveryInternal {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedRawDigest,
    [Parameter(Mandatory = $true)][string]$ExpectedBootIdentity,
    [Parameter(Mandatory = $true)][string]$ExpectedOwnerSid,
    [Parameter(Mandatory = $true)][uint32]$ExpectedGuardianPid,
    [int64]$ExpectedGuardianCreationIdentity = 0,
    [Parameter(Mandatory = $true)][string]$ExpectedFenceName,
    [Parameter(Mandatory = $true)][string]$ExpectedValueName,
    [switch]$LegacyBreakGlass,
    [switch]$DryRun,
    [string]$InternalRegistrySubKey = "Software\MoaWork\GateLease",
    [string]$InternalFenceName = "Global\MoaWork.FullGate.v1",
    [int]$InternalPort = 48761,
    [scriptblock]$InternalBeforeAtomicRead,
    [scriptblock]$InternalAfterDelete
  )

  $expectedDigest = $ExpectedRawDigest.ToLowerInvariant()
  if ($expectedDigest -notmatch '^[0-9a-f]{64}$') { throw "RECOVERY_DIGEST_INVALID" }
  $currentSid = (Get-CurrentSid).Value
  if ($ExpectedOwnerSid -ne $currentSid) { throw "RECOVERY_OWNER_SID_MISMATCH" }
  if ($ExpectedFenceName -ne $InternalFenceName) { throw "RECOVERY_FENCE_MISMATCH" }
  $computedName = Get-GateLeaseRecoveryValueName $InternalFenceName
  if ($ExpectedValueName -ne $computedName) { throw "RECOVERY_VALUE_NAME_MISMATCH" }
  if ($ExpectedBootIdentity -ne (Get-GateLeaseRecoveryBootIdentity)) { throw "RECOVERY_BOOT_MISMATCH" }

  $mutex = Open-RecoveryMutex $InternalFenceName
  $owned = $false
  $abandoned = $false
  try {
    try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true; $abandoned = $true }
    if (-not $owned) { throw "RECOVERY_FENCE_BUSY" }
    if ($InternalBeforeAtomicRead) { & $InternalBeforeAtomicRead }

    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($InternalRegistrySubKey, $true)
    if ($null -eq $key) { throw "RECOVERY_MARKER_KEY_MISSING" }
    try {
      $owner = $key.GetAccessControl().GetOwner([Security.Principal.SecurityIdentifier]).Value
      if ($owner -ne $currentSid) { throw "RECOVERY_REGISTRY_OWNER_INVALID" }
      $strictAcl = Test-OwnerOnlyRegistryAcl $key
      $raw = $key.GetValue($computedName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -eq $raw) { throw "RECOVERY_MARKER_MISSING" }
      $raw = [string]$raw
      if ((Get-GateLeaseRecoverySha256 $raw) -ne $expectedDigest) { throw "RECOVERY_DIGEST_MISMATCH" }
      try { $marker = $raw | ConvertFrom-Json } catch { throw "RECOVERY_MARKER_MALFORMED" }
      $hasVersion = $marker.PSObject.Properties.Name -contains "version"
      if ($hasVersion -and (-not (Test-JsonIntegralType $marker.version) -or [int64]$marker.version -ne 1)) { throw "RECOVERY_MARKER_VERSION_UNSUPPORTED" }
      $isV1 = $hasVersion
      if ($isV1) {
        $required = @("version", "guardianPid", "guardianCreationIdentity", "ownerSid", "bootIdentity", "fenceName", "createdAt")
        $allowed = $required + @("commandPid", "commandCreationIdentity", "jobActiveProcesses")
        if (-not (Test-ExactPropertySet $marker $allowed $required)) { throw "RECOVERY_MARKER_V1_SCHEMA_INVALID" }
        if (-not (Test-JsonIntegralType $marker.guardianPid) -or [int64]$marker.guardianPid -le 0 -or [int64]$marker.guardianPid -gt [uint32]::MaxValue) { throw "RECOVERY_MARKER_V1_TYPE_INVALID" }
        if (-not (Test-JsonIntegralType $marker.guardianCreationIdentity) -or [int64]$marker.guardianCreationIdentity -le 0) { throw "RECOVERY_MARKER_V1_TYPE_INVALID" }
        if ($marker.ownerSid -isnot [string] -or -not $marker.ownerSid) { throw "RECOVERY_MARKER_V1_TYPE_INVALID" }
        if ($marker.bootIdentity -isnot [string] -or -not $marker.bootIdentity) { throw "RECOVERY_MARKER_V1_TYPE_INVALID" }
        if ($marker.fenceName -isnot [string] -or -not $marker.fenceName) { throw "RECOVERY_MARKER_V1_TYPE_INVALID" }
        if ($marker.createdAt -isnot [string] -or -not $marker.createdAt) { throw "RECOVERY_MARKER_V1_TYPE_INVALID" }
        $optional = @("commandPid", "commandCreationIdentity", "jobActiveProcesses")
        $optionalCount = @($optional | Where-Object { $marker.PSObject.Properties.Name -contains $_ }).Count
        if ($optionalCount -ne 0 -and $optionalCount -ne $optional.Count) { throw "RECOVERY_MARKER_V1_SCHEMA_INVALID" }
        if ($optionalCount -ne 0) {
          if (-not (Test-JsonIntegralType $marker.commandPid) -or [int64]$marker.commandPid -le 0 -or [int64]$marker.commandPid -gt [uint32]::MaxValue) { throw "RECOVERY_MARKER_V1_TYPE_INVALID" }
          if (-not (Test-JsonIntegralType $marker.commandCreationIdentity) -or [int64]$marker.commandCreationIdentity -le 0) { throw "RECOVERY_MARKER_V1_TYPE_INVALID" }
          if (-not (Test-JsonIntegralType $marker.jobActiveProcesses) -or [int64]$marker.jobActiveProcesses -lt 0) { throw "RECOVERY_MARKER_V1_TYPE_INVALID" }
        }
        if (-not $strictAcl) { throw "RECOVERY_REGISTRY_ACL_INVALID" }
        if ([string]$marker.ownerSid -ne $ExpectedOwnerSid) { throw "RECOVERY_MARKER_OWNER_MISMATCH" }
        if ($ExpectedGuardianCreationIdentity -le 0) { throw "RECOVERY_EXPECTED_CREATION_INVALID" }
        if ([int64]$marker.guardianCreationIdentity -ne $ExpectedGuardianCreationIdentity) { throw "RECOVERY_MARKER_CREATION_MISMATCH" }
        $liveIdentity = Get-GateLeaseRecoveryProcessIdentity $ExpectedGuardianPid
        if ($null -ne $liveIdentity -and [int64]$liveIdentity -eq $ExpectedGuardianCreationIdentity) { throw "RECOVERY_OWNER_LIVE" }
      } else {
        $legacyProperties = @($marker.PSObject.Properties.Name | Sort-Object)
        if (($legacyProperties -join ",") -ne "bootIdentity,fenceName,guardianPid") { throw "RECOVERY_LEGACY_SCHEMA_INVALID" }
        if (-not (Test-JsonIntegralType $marker.guardianPid) -or [int64]$marker.guardianPid -le 0 -or [int64]$marker.guardianPid -gt [uint32]::MaxValue) { throw "RECOVERY_LEGACY_TYPE_INVALID" }
        if ($marker.bootIdentity -isnot [string] -or -not $marker.bootIdentity -or $marker.fenceName -isnot [string] -or -not $marker.fenceName) { throw "RECOVERY_LEGACY_TYPE_INVALID" }
        if (-not $LegacyBreakGlass) { throw "RECOVERY_LEGACY_BREAK_GLASS_REQUIRED" }
        if ($ExpectedGuardianCreationIdentity -ne 0) { throw "RECOVERY_LEGACY_CREATION_IDENTITY_INVALID" }
        if ($null -ne (Get-GateLeaseRecoveryProcessIdentity $ExpectedGuardianPid)) { throw "RECOVERY_LEGACY_PID_LIVE" }
      }

      if ([string]$marker.bootIdentity -ne $ExpectedBootIdentity) { throw "RECOVERY_MARKER_BOOT_MISMATCH" }
      if ([string]$marker.fenceName -ne $ExpectedFenceName) { throw "RECOVERY_MARKER_FENCE_MISMATCH" }
      if ([uint32][int64]$marker.guardianPid -ne $ExpectedGuardianPid) { throw "RECOVERY_MARKER_PID_MISMATCH" }

      if (@(Test-GateListener $InternalPort).Count -ne 0) { throw "RECOVERY_LISTENER_LIVE" }
      if (@(Test-RelevantGateProcesses).Count -ne 0) { throw "RECOVERY_GATE_PROCESS_LIVE" }

      if ($DryRun) {
        return [pscustomobject]@{
          result = "dry-run"; cleared = $false; wouldClear = $true; legacy = -not $isV1
          aclWouldHarden = (-not $strictAcl); priorDigest = $expectedDigest; bootIdentity = $ExpectedBootIdentity
          abandonedFence = $abandoned
        }
      }

      if (-not $strictAcl) {
        if (-not $LegacyBreakGlass) { throw "RECOVERY_REGISTRY_ACL_INVALID" }
        Set-OwnerOnlyRegistryAcl $key
        if (-not (Test-OwnerOnlyRegistryAcl $key)) { throw "RECOVERY_REGISTRY_ACL_HARDEN_FAILED" }
        $reread = [string]$key.GetValue($computedName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ((Get-GateLeaseRecoverySha256 $reread) -ne $expectedDigest) { throw "RECOVERY_REREAD_MISMATCH" }
      }

      $audit = $null
      $auditValueName = "Recovery_" + [Guid]::NewGuid().ToString("N")
      $receiptBase = [ordered]@{
        version = 1; priorDigest = $expectedDigest; priorBootIdentity = $ExpectedBootIdentity
        priorGuardianPid = $ExpectedGuardianPid; priorGuardianCreationIdentity = $ExpectedGuardianCreationIdentity
        fenceName = $ExpectedFenceName; valueName = $ExpectedValueName; legacy = -not $isV1
        actorSid = $currentSid; actorPid = $PID; actorCreationIdentity = Get-GateLeaseRecoveryProcessIdentity ([uint32]$PID)
      }
      try {
        $audit = $key.CreateSubKey("RecoveryAudit", $true)
        Set-OwnerOnlyRegistryAcl $audit
        $prepared = [ordered]@{} + $receiptBase
        $prepared.preparedAt = [DateTimeOffset]::UtcNow.ToString("o")
        $prepared.result = "prepared"
        $audit.SetValue($auditValueName, ($prepared | ConvertTo-Json -Compress), [Microsoft.Win32.RegistryValueKind]::String)
        $audit.Flush()

        $key.DeleteValue($computedName, $false)
        $key.Flush()
        if ($InternalAfterDelete) { & $InternalAfterDelete $key $computedName $raw }
        if ($null -ne $key.GetValue($computedName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)) { throw "RECOVERY_DELETE_VERIFY_FAILED" }
        $cleared = [ordered]@{} + $receiptBase
        $cleared.recoveredAt = [DateTimeOffset]::UtcNow.ToString("o")
        $cleared.result = "cleared"
        $audit.SetValue($auditValueName, ($cleared | ConvertTo-Json -Compress), [Microsoft.Win32.RegistryValueKind]::String)
        $audit.Flush()
        $key.Flush()
      } catch {
        $current = $key.GetValue($computedName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -eq $current) {
          $key.SetValue($computedName, $raw, [Microsoft.Win32.RegistryValueKind]::String)
          $key.Flush()
        }
        $restored = [string]$key.GetValue($computedName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        if ($null -ne $audit -and $restored -ceq $raw) {
          try {
            $rolledBack = [ordered]@{} + $receiptBase
            $rolledBack.rolledBackAt = [DateTimeOffset]::UtcNow.ToString("o")
            $rolledBack.result = "rolled-back"
            $audit.SetValue($auditValueName, ($rolledBack | ConvertTo-Json -Compress), [Microsoft.Win32.RegistryValueKind]::String)
            $audit.Flush()
          } catch {}
        }
        throw "RECOVERY_AUDIT_WRITE_FAILED"
      } finally {
        if ($null -ne $audit) { $audit.Dispose() }
      }

      return [pscustomobject]@{
        result = "cleared"; cleared = $true; legacy = -not $isV1; priorDigest = $expectedDigest
        bootIdentity = $ExpectedBootIdentity; abandonedFence = $abandoned
      }
    } finally { $key.Dispose() }
  } finally {
    if ($owned) { try { $mutex.ReleaseMutex() } catch {} }
    $mutex.Dispose()
  }
}

function Invoke-GateLeaseRecovery {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedRawDigest,
    [Parameter(Mandatory = $true)][string]$ExpectedBootIdentity,
    [Parameter(Mandatory = $true)][string]$ExpectedOwnerSid,
    [Parameter(Mandatory = $true)][uint32]$ExpectedGuardianPid,
    [int64]$ExpectedGuardianCreationIdentity = 0,
    [Parameter(Mandatory = $true)][string]$ExpectedFenceName,
    [Parameter(Mandatory = $true)][string]$ExpectedValueName,
    [switch]$LegacyBreakGlass,
    [switch]$DryRun
  )
  return Invoke-GateLeaseRecoveryInternal @PSBoundParameters
}

Export-ModuleMember -Function Invoke-GateLeaseRecovery
