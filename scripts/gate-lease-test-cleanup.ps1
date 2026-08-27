param([string]$FenceName = "", [switch]$AllTests)
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\MoaWork\GateLease", $true)
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
} finally { $key.Dispose() }
