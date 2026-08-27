param([string]$FenceName = "", [switch]$AllTests)
$subKey = if ($AllTests -or $FenceName.StartsWith("Global\MoaWork.FullGate.Test.")) { "Software\MoaWork\GateLeaseTest" } else { "Software\MoaWork\GateLease" }
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($subKey, $true)
if ($null -eq $key) { exit 0 }
try {
  if ($AllTests) {
    foreach ($name in $key.GetValueNames()) {
      $value = [string]$key.GetValue($name, "")
      if ($value -match 'Global\\\\MoaWork\.FullGate\.Test\.') { $key.DeleteValue($name, $false) }
    }
  } elseif ($FenceName) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      $bytes = [Text.Encoding]::UTF8.GetBytes($FenceName)
      $name = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "")
      $key.DeleteValue($name, $false)
    } finally { $sha.Dispose() }
  }
  $empty = @($key.GetValueNames()).Count -eq 0 -and @($key.GetSubKeyNames()).Count -eq 0
} finally { $key.Dispose() }
if ($empty -and $subKey -eq "Software\MoaWork\GateLeaseTest") {
  try { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($subKey, $false) } catch {}
}
