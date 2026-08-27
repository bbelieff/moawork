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

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSEdition -ne "Desktop" -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
  [Console]::Error.WriteLine("GATE_LEASE_RECOVERY_FAILURE $(@{ code = 'RECOVERY_POWERSHELL_UNSUPPORTED'; cleared = $false } | ConvertTo-Json -Compress)")
  exit 78
}
$module = Join-Path $PSScriptRoot "gate-lease-recovery-core.psm1"
Import-Module $module -Force

try {
  $result = Invoke-GateLeaseRecovery `
    -ExpectedRawDigest $ExpectedRawDigest `
    -ExpectedBootIdentity $ExpectedBootIdentity `
    -ExpectedOwnerSid $ExpectedOwnerSid `
    -ExpectedGuardianPid $ExpectedGuardianPid `
    -ExpectedGuardianCreationIdentity $ExpectedGuardianCreationIdentity `
    -ExpectedFenceName $ExpectedFenceName `
    -ExpectedValueName $ExpectedValueName `
    -LegacyBreakGlass:$LegacyBreakGlass `
    -DryRun:$DryRun
  [Console]::Out.WriteLine("GATE_LEASE_RECOVERY_RESULT $($result | ConvertTo-Json -Compress -Depth 8)")
  exit 0
} catch {
  [Console]::Error.WriteLine("GATE_LEASE_RECOVERY_FAILURE $(@{ code = [string]$_.Exception.Message; cleared = $false } | ConvertTo-Json -Compress)")
  exit 78
}
