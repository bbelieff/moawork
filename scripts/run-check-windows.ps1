[CmdletBinding()]
param(
  [switch]$ProbeOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Exit-CheckShellFailure {
  param(
    [Parameter(Mandatory = $true)][string]$Code,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $payload = [ordered]@{ code = $Code; message = $Message } | ConvertTo-Json -Compress
  [Console]::Error.WriteLine("CHECK_SHELL_FAILURE $payload")
  exit 78
}

function Assert-BashStartupEnvironmentClean {
  $forbiddenNames = @("BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "CDPATH", "GLOBIGNORE")
  $present = @(
    [Environment]::GetEnvironmentVariables([EnvironmentVariableTarget]::Process).Keys |
      ForEach-Object { [string]$_ } |
      Where-Object {
        $name = $_
        $forbiddenNames -contains $name.ToUpperInvariant() -or $name -match '(?i)^BASH_FUNC_.*%%$'
      } |
      Sort-Object -Unique
  )
  if ($present.Count -gt 0) {
    Exit-CheckShellFailure "CHECK_BASH_STARTUP_ENV_FORBIDDEN" ("forbidden Bash startup environment keys: " + ($present -join ", "))
  }
}

try {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Exit-CheckShellFailure "CHECK_SHELL_WINDOWS_REQUIRED" "the Windows canonical shell launcher requires Win32NT"
  }

  $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
  if ([string]::IsNullOrWhiteSpace($programFiles)) {
    Exit-CheckShellFailure "CHECK_GIT_BASH_UNAVAILABLE" "the machine Program Files directory is unavailable"
  }

  $gitRoot = [IO.Path]::GetFullPath((Join-Path $programFiles "Git"))
  $candidate = [IO.Path]::GetFullPath((Join-Path $gitRoot "bin\bash.exe"))
  if (-not [IO.File]::Exists($candidate)) {
    Exit-CheckShellFailure "CHECK_GIT_BASH_UNAVAILABLE" "Git for Windows Bash is not installed at the fixed machine path"
  }

  foreach ($path in @($gitRoot, (Join-Path $gitRoot "bin"), $candidate)) {
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      Exit-CheckShellFailure "CHECK_GIT_BASH_REPARSE_REJECTED" "the fixed Git for Windows path contains a reparse point"
    }
  }

  $resolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $candidate).ProviderPath)
  if (-not [string]::Equals($resolved, $candidate, [StringComparison]::OrdinalIgnoreCase)) {
    Exit-CheckShellFailure "CHECK_GIT_BASH_PATH_MISMATCH" "the resolved Bash executable differs from the fixed machine path"
  }

  $stream = [IO.File]::Open($resolved, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    if ($stream.ReadByte() -ne 0x4d -or $stream.ReadByte() -ne 0x5a) {
      Exit-CheckShellFailure "CHECK_GIT_BASH_NOT_WINDOWS_PE" "the fixed Bash executable is not a Windows PE image"
    }
  } finally {
    $stream.Dispose()
  }

  $signature = Get-AuthenticodeSignature -LiteralPath $resolved
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    Exit-CheckShellFailure "CHECK_GIT_BASH_SIGNATURE_INVALID" "the fixed Bash executable does not have a valid Authenticode signature"
  }

  $version = (Get-Item -LiteralPath $resolved).VersionInfo
  if ($version.ProductName -ne "Git" -or $version.FileDescription -ne "Git for Windows") {
    Exit-CheckShellFailure "CHECK_GIT_BASH_PRODUCT_MISMATCH" "the fixed executable is not identified as Git for Windows"
  }

  Assert-BashStartupEnvironmentClean
  $probe = @(& $resolved --noprofile --norc -c 'printf "BASH=%s\nUNAME=%s\nROOT=%s\n" "$BASH_VERSION" "$(uname -s)" "$(cygpath -w /)"' 2>&1 | ForEach-Object { [string]$_ })
  $probeExit = $LASTEXITCODE
  if ($probeExit -ne 0) {
    Exit-CheckShellFailure "CHECK_GIT_BASH_PROBE_FAILED" "the fixed Bash executable failed its family probe"
  }

  $bashVersion = ($probe | Where-Object { $_ -like "BASH=*" } | Select-Object -First 1) -replace '^BASH=', ''
  $uname = ($probe | Where-Object { $_ -like "UNAME=*" } | Select-Object -First 1) -replace '^UNAME=', ''
  $runtimeRoot = ($probe | Where-Object { $_ -like "ROOT=*" } | Select-Object -First 1) -replace '^ROOT=', ''
  if ([string]::IsNullOrWhiteSpace($bashVersion) -or $uname -notmatch '^(MINGW(32|64)|MSYS)_NT-') {
    Exit-CheckShellFailure "CHECK_GIT_BASH_FAMILY_MISMATCH" "the fixed Bash executable did not report a Git-for-Windows runtime family"
  }
  if ([string]::IsNullOrWhiteSpace($runtimeRoot)) {
    Exit-CheckShellFailure "CHECK_GIT_BASH_ROOT_MISSING" "the fixed Bash executable did not report its installation root"
  }

  $runtimeRootFull = [IO.Path]::GetFullPath($runtimeRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $gitRootFull = $gitRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  if (-not [string]::Equals($runtimeRootFull, $gitRootFull, [StringComparison]::OrdinalIgnoreCase)) {
    Exit-CheckShellFailure "CHECK_GIT_BASH_ROOT_MISMATCH" "the Bash runtime root differs from the verified Git installation"
  }

  $ready = [ordered]@{
    path = $resolved
    family = $uname
    product = $version.FileDescription
    root = $runtimeRootFull
  } | ConvertTo-Json -Compress
  [Console]::Out.WriteLine("CHECK_SHELL_READY $ready")
  if ($ProbeOnly) {
    exit 0
  }

  $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
  Push-Location -LiteralPath $repoRoot
  try {
    Assert-BashStartupEnvironmentClean
    & $resolved --noprofile --norc "scripts/check.sh"
    $checkExit = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($null -eq $checkExit) {
    Exit-CheckShellFailure "CHECK_SHELL_EXIT_MISSING" "Git for Windows Bash returned no process exit code"
  }
  exit [int]$checkExit
} catch {
  Exit-CheckShellFailure "CHECK_SHELL_VALIDATION_FAILED" $_.Exception.Message
}
