param(
  [Parameter(Mandatory = $true)][string]$PipeName,
  [Parameter(Mandatory = $true)][string]$PipeNonce,
  [Parameter(Mandatory = $true)][int]$BootstrapWrapperPid
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

public sealed class MoaWorkPipeServer : IDisposable {
  readonly NamedPipeServerStream pipe;
  readonly ConcurrentQueue<string> messages = new ConcurrentQueue<string>();
  StreamReader reader;
  StreamWriter writer;
  Thread readThread;
  volatile bool eof;
  public MoaWorkPipeServer(string name) {
    var security = new PipeSecurity();
    var sid = WindowsIdentity.GetCurrent().User;
    security.SetOwner(sid);
    security.SetAccessRuleProtection(true, false);
    security.AddAccessRule(new PipeAccessRule(sid, PipeAccessRights.FullControl, AccessControlType.Allow));
    pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
      PipeOptions.Asynchronous | PipeOptions.WriteThrough, 4096, 4096, security);
  }
  public bool WaitForConnection(int timeoutMs) {
    var ar = pipe.BeginWaitForConnection(null, null);
    if (!ar.AsyncWaitHandle.WaitOne(timeoutMs)) return false;
    pipe.EndWaitForConnection(ar);
    reader = new StreamReader(pipe, new UTF8Encoding(false), false, 4096, true);
    writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, true); writer.AutoFlush = true;
    readThread = new Thread(() => {
      try { for (;;) { var line = reader.ReadLine(); if (line == null) break; messages.Enqueue(line); } }
      catch { } finally { eof = true; }
    });
    readThread.IsBackground = true; readThread.Name = "MoaWorkGatePipeReader"; readThread.Start();
    return true;
  }
  public bool TryRead(out string value) { return messages.TryDequeue(out value); }
  public bool Eof { get { return eof; } }
  public void WriteLine(string line) { writer.WriteLine(line); writer.Flush(); }
  public void Dispose() { try { pipe.Dispose(); } catch {} }
}

public sealed class MoaWorkProcessHandle : IDisposable {
  const uint SYNCHRONIZE = 0x00100000;
  const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x00001000;
  [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint Low; public uint High; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern ulong GetTickCount64();
  IntPtr handle;
  public long CreationIdentity { get; private set; }
  public bool Exited { get { return WaitForSingleObject(handle, 0) == 0; } }
  public static MoaWorkProcessHandle Open(uint processId) {
    var instance = new MoaWorkProcessHandle();
    instance.handle = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
    if (instance.handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess wrapper failed");
    FILETIME creation, exit, kernel, user;
    if (!GetProcessTimes(instance.handle, out creation, out exit, out kernel, out user)) { instance.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error(), "GetProcessTimes wrapper failed"); }
    instance.CreationIdentity = ((long)creation.High << 32) | creation.Low;
    return instance;
  }
  public static string BootIdentity() {
    long bootTicks = DateTime.UtcNow.Ticks - (long)GetTickCount64() * TimeSpan.TicksPerMillisecond;
    bootTicks -= bootTicks % TimeSpan.TicksPerMinute;
    return Environment.MachineName + ":" + bootTicks.ToString("x");
  }
  public void Dispose() { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
}

public sealed class MoaWorkGateJob : IDisposable {
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint STARTF_USESTDHANDLES = 0x00000100;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const int JobObjectBasicAccountingInformation = 1;
  const int JobObjectExtendedLimitInformation = 9;
  const uint STILL_ACTIVE = 259;
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO {
    public uint cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public uint dwX; public uint dwY; public uint dwXSize; public uint dwYSize;
    public uint dwXCountChars; public uint dwYCountChars; public uint dwFillAttribute;
    public uint dwFlags; public short wShowWindow; public short cbReserved2;
    public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS {
    public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
    public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
    public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint Low; public uint High; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, out uint returnLength);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int stdHandle);
  IntPtr job; IntPtr process;
  public uint ProcessId { get; private set; }
  public long CreationIdentity { get; private set; }
  static string Quote(string value) {
    if (value.Length > 0 && value.IndexOfAny(new [] {' ', '\t', '\n', '\v', '"'}) < 0) return value;
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); slashes = 0; continue; }
      result.Append('\\', slashes); slashes = 0; result.Append(c);
    }
    result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
  }
  public static MoaWorkGateJob Start(string command, string[] args, string cwd) {
    var instance = new MoaWorkGateJob(); instance.job = CreateJobObjectW(IntPtr.Zero, null);
    if (instance.job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed");
    var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION(); limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    int size = Marshal.SizeOf(limits); IntPtr ptr = Marshal.AllocHGlobal(size);
    try { Marshal.StructureToPtr(limits, ptr, false); if (!SetInformationJobObject(instance.job, JobObjectExtendedLimitInformation, ptr, (uint)size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject failed"); }
    finally { Marshal.FreeHGlobal(ptr); }
    var line = new StringBuilder(Quote(command)); foreach (var arg in args) line.Append(' ').Append(Quote(arg));
    var startup = new STARTUPINFO(); startup.cb = (uint)Marshal.SizeOf(startup); startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(-10); startup.hStdOutput = GetStdHandle(-11); startup.hStdError = GetStdHandle(-12);
    PROCESS_INFORMATION pi;
    if (!CreateProcessW(command, line, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero, cwd, ref startup, out pi)) { instance.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessW failed"); }
    instance.process = pi.hProcess; instance.ProcessId = pi.dwProcessId;
    try {
      if (!AssignProcessToJobObject(instance.job, instance.process)) { TerminateProcess(instance.process, 78); throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed"); }
      FILETIME creation, exit, kernel, user; if (!GetProcessTimes(instance.process, out creation, out exit, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error(), "GetProcessTimes failed");
      instance.CreationIdentity = ((long)creation.High << 32) | creation.Low;
      if (ResumeThread(pi.hThread) == 0xffffffff) throw new Win32Exception(Marshal.GetLastWin32Error(), "ResumeThread failed");
    } catch { TerminateJobObject(instance.job, 78); instance.Dispose(); throw; }
    finally { CloseHandle(pi.hThread); }
    return instance;
  }
  public bool PrimaryExited { get { return process != IntPtr.Zero && WaitForSingleObject(process, 0) == 0; } }
  public uint CaptureExitAndClosePrimary() { uint value; if (!GetExitCodeProcess(process, out value)) throw new Win32Exception(Marshal.GetLastWin32Error()); if (value == STILL_ACTIVE) throw new InvalidOperationException("primary active"); CloseHandle(process); process = IntPtr.Zero; return value; }
  public uint ActiveProcesses { get { int size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)); IntPtr ptr = Marshal.AllocHGlobal(size); try { uint returned; if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, ptr, (uint)size, out returned)) throw new Win32Exception(Marshal.GetLastWin32Error()); return ((JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(ptr, typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION))).ActiveProcesses; } finally { Marshal.FreeHGlobal(ptr); } } }
  public void Terminate(uint code) { if (!TerminateJobObject(job, code)) { int error = Marshal.GetLastWin32Error(); if (error != 6) throw new Win32Exception(error); } }
  public void Dispose() { if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; } if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; } }
}
'@

function Write-Structured([string]$Kind, [hashtable]$Detail) { try { [Console]::Error.WriteLine("$Kind $($Detail | ConvertTo-Json -Compress -Depth 8)") } catch {} }
function Fail([string]$Code, [string]$Message, [hashtable]$Detail = @{}) { Write-Structured "GATE_LEASE_FAILURE" @{ code = $Code; message = $Message; detail = $Detail } }
function Write-ReleaseDegraded([string]$Code, [int]$ChildExitCode) {
  try { [Console]::Error.WriteLine("GATE_LEASE_RELEASE_DEGRADED: gate command finished; preserving child exit code $ChildExitCode after activeProcesses=0; broker recovery required ($Code)") } catch {}
}
function Send-Pipe($Pipe, [hashtable]$Message) { $Pipe.WriteLine(($Message | ConvertTo-Json -Compress -Depth 8)) }
function Send-Broker($Writer, [hashtable]$Message) {
  try { $Writer.WriteLine(($Message | ConvertTo-Json -Compress -Depth 8)); $Writer.Flush() }
  catch { throw [InvalidOperationException]::new("GATE_BROKER_WRITE_FAILED", $_.Exception) }
}
function Read-Broker($Reader, [int]$TimeoutMs) {
  try {
    $task = $Reader.ReadLineAsync()
    if (-not $task.Wait($TimeoutMs)) { throw "GATE_BROKER_READ_TIMEOUT" }
    return $task.Result
  } catch {
    if ([string]$_.Exception.Message -eq "GATE_BROKER_READ_TIMEOUT") { throw }
    throw [InvalidOperationException]::new("GATE_BROKER_READ_FAILED", $_.Exception)
  }
}
function Read-BrokerMessage($Reader, [int]$TimeoutMs, [string]$Phase) {
  $line = Read-Broker $Reader $TimeoutMs
  if ($null -eq $line) { throw ("GATE_BROKER_{0}_EOF" -f $Phase) }
  try { $message = $line | ConvertFrom-Json -ErrorAction Stop }
  catch { throw ("GATE_BROKER_{0}_MALFORMED" -f $Phase) }
  if ($null -eq $message -or -not ($message.PSObject.Properties.Name -contains "type") -or $message.type -isnot [string]) {
    throw ("GATE_BROKER_{0}_SCHEMA" -f $Phase)
  }
  return $message
}
function Has-StringProperty($Message, [string]$Name) {
  return $Message.PSObject.Properties.Name -contains $Name -and $Message.$Name -is [string]
}
function Equals-OrdinalString([string]$Left, [string]$Right) {
  return [string]::Equals($Left, $Right, [StringComparison]::Ordinal)
}
function Close-Broker($Client) {
  try { $Client.Client.Shutdown([Net.Sockets.SocketShutdown]::Send); $Client.Close() }
  catch { throw [InvalidOperationException]::new("GATE_BROKER_CLOSE_FAILED", $_.Exception) }
}
function Wait-Zero($Job, [int]$TimeoutMs, [bool]$InjectHang) {
  $deadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + $TimeoutMs
  while ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $deadline) { if (-not $InjectHang -and $Job.ActiveProcesses -eq 0) { return $true }; Start-Sleep -Milliseconds 25 }
  return (-not $InjectHang -and $Job.ActiveProcesses -eq 0)
}
function Quarantine([string]$Reason) { Fail "GATE_GUARDIAN_QUARANTINED" "machine fence quarantined" @{ reason = $Reason }; while ($true) { Start-Sleep -Seconds 60 } }
function Open-SafeFence([string]$Name) {
  if (-not $Name.StartsWith("Global\MoaWork.FullGate.")) { throw "GATE_FENCE_NAME_INVALID" }
  $created = $false
  $mutex = [Threading.Mutex]::new($false, $Name, [ref]$created)
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  if ($created) {
    $security = [Security.AccessControl.MutexSecurity]::new()
    $security.SetOwner($sid); $security.SetAccessRuleProtection($true, $false)
    $security.AddAccessRule([Security.AccessControl.MutexAccessRule]::new($sid, [Security.AccessControl.MutexRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    $mutex.SetAccessControl($security)
  } else {
    $security = $mutex.GetAccessControl()
    if ($security.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or -not $security.AreAccessRulesProtected) { throw "GATE_FENCE_ACL_INVALID" }
  }
  return $mutex
}
function Fence-MarkerName([string]$Name) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Name)))).Replace("-", "") }
  finally { $sha.Dispose() }
}
function Set-OwnerOnlyMarkerAcl([Microsoft.Win32.RegistryKey]$Key) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $security = [Security.AccessControl.RegistrySecurity]::new()
  $security.SetOwner($sid)
  $security.SetAccessRuleProtection($true, $false)
  $security.AddAccessRule([Security.AccessControl.RegistryAccessRule]::new(
    $sid,
    [Security.AccessControl.RegistryRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]::ContainerInherit,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  ))
  $Key.SetAccessControl($security)
}
function Marker-RegistrySubKey([string]$Name) {
  if ($Name.StartsWith("Global\MoaWork.FullGate.Test.", [StringComparison]::Ordinal)) { return "Software\MoaWork\GateLeaseTest" }
  return "Software\MoaWork\GateLease"
}
function Open-MarkerKey([string]$Name) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey((Marker-RegistrySubKey $Name), $true)
  try { Set-OwnerOnlyMarkerAcl $key; return $key } catch { $key.Dispose(); throw }
}
function Get-ProcessCreationIdentity([uint32]$ProcessId) {
  $handle = [MoaWorkProcessHandle]::Open($ProcessId)
  try { return $handle.CreationIdentity } finally { $handle.Dispose() }
}
function Assert-NoFenceMarker([string]$Name) {
  $key = Open-MarkerKey $Name
  try {
    $markerName = Fence-MarkerName $Name
    if ($null -ne $key.GetValue($markerName, $null)) { Quarantine "durable-crash-marker" }
    $audit = $key.OpenSubKey("RecoveryAudit", $false)
    try {
      if ($null -ne $audit) {
        foreach ($valueName in $audit.GetValueNames()) {
          try { $receipt = ([string]$audit.GetValue($valueName, "")) | ConvertFrom-Json } catch { Quarantine "recovery-audit-malformed" }
          if ($receipt.fenceName -eq $Name -and $receipt.valueName -eq $markerName -and $receipt.result -eq "prepared") {
            Quarantine "recovery-incomplete"
          }
        }
      }
    } finally { if ($null -ne $audit) { $audit.Dispose() } }
  }
  finally { $key.Dispose() }
}
function Set-FenceMarker([string]$Name, $Job = $null, [string]$CreatedAt = "") {
  $key = Open-MarkerKey $Name
  try {
    if (-not $CreatedAt) { $CreatedAt = [DateTimeOffset]::UtcNow.ToString("o") }
    $marker = [ordered]@{
      version = 1
      guardianPid = $PID
      guardianCreationIdentity = Get-ProcessCreationIdentity ([uint32]$PID)
      ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      bootIdentity = [MoaWorkProcessHandle]::BootIdentity()
      fenceName = $Name
      createdAt = $CreatedAt
    }
    if ($null -ne $Job) {
      $marker.commandPid = $Job.ProcessId
      $marker.commandCreationIdentity = $Job.CreationIdentity
      $marker.jobActiveProcesses = $Job.ActiveProcesses
    }
    $marker = $marker | ConvertTo-Json -Compress
    $key.SetValue((Fence-MarkerName $Name), $marker, [Microsoft.Win32.RegistryValueKind]::String)
    return $CreatedAt
  } finally { $key.Dispose() }
}
function Remove-FenceMarker([string]$Name) {
  $key = Open-MarkerKey $Name
  try { $key.DeleteValue((Fence-MarkerName $Name), $false) } finally { $key.Dispose() }
  if ($Name.StartsWith("Global\MoaWork.FullGate.Test.", [StringComparison]::Ordinal)) {
    $testKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Software\MoaWork\GateLeaseTest", $false)
    try { $empty = $null -ne $testKey -and @($testKey.GetValueNames()).Count -eq 0 -and @($testKey.GetSubKeyNames()).Count -eq 0 }
    finally { if ($null -ne $testKey) { $testKey.Dispose() } }
    if ($empty) { try { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey("Software\MoaWork\GateLeaseTest", $false) } catch {} }
  }
}

$pipe = $null; $wrapper = $null; $fence = $null; $fenceOwned = $false; $markerOwned = $false; $markerCreatedAt = ""; $client = $null; $job = $null; $payload = $null; $stage = "bootstrap"; $commandResultVerified = $false
try {
  if (-not $PipeName.StartsWith("moawork-gate-") -or $PipeNonce.Length -lt 16) { throw "GATE_PIPE_IDENTITY_INVALID" }
  $wrapper = [MoaWorkProcessHandle]::Open([uint32]$BootstrapWrapperPid)
  if ($wrapper.Exited) { throw "GATE_WRAPPER_EXITED" }
  $pipe = [MoaWorkPipeServer]::new($PipeName)
  if (-not $pipe.WaitForConnection(8000)) { throw "GATE_PIPE_CONNECT_TIMEOUT" }
  $payloadDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 2000
  $payloadLine = $null
  while ($null -eq $payloadLine -and [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $payloadDeadline) { if (-not $pipe.TryRead([ref]$payloadLine)) { if ($pipe.Eof) { throw "GATE_PIPE_EOF" }; Start-Sleep -Milliseconds 10 } }
  if ($null -eq $payloadLine) { throw "GATE_PIPE_PAYLOAD_TIMEOUT" }
  try { $envelope = $payloadLine | ConvertFrom-Json } catch { throw "GATE_PIPE_MALFORMED" }
  if ($envelope.type -ne "payload" -or -not (Has-StringProperty $envelope "nonce") -or -not (Equals-OrdinalString $envelope.nonce $PipeNonce)) { throw "GATE_PIPE_NONCE_INVALID" }
  $payload = $envelope.payload
  if ($payload.protocol -ne "moawork-gate-guardian-v2" -or $payload.wrapperPid -ne $BootstrapWrapperPid -or $payload.host -ne "127.0.0.1") { throw "GATE_PAYLOAD_INVALID" }
  if ($wrapper.Exited) { throw "GATE_WRAPPER_EXITED" }
  $hasFault = $payload.PSObject.Properties.Name -contains "testFault"
  if ($hasFault -and $payload.testFault -eq "stall-bootstrap") { Start-Sleep -Seconds 60 }
  $fence = Open-SafeFence ([string]$payload.fenceName)
  Send-Pipe $pipe @{ type = "ready"; nonce = $PipeNonce; guardianPid = $PID; wrapperPid = $BootstrapWrapperPid; wrapperCreationIdentity = $wrapper.CreationIdentity; fenceName = $payload.fenceName; bootIdentity = [MoaWorkProcessHandle]::BootIdentity() }

  $stage = "broker"
  $client = [Net.Sockets.TcpClient]::new(); $connect = $client.ConnectAsync([string]$payload.host, [int]$payload.port); if (-not $connect.Wait(5000)) { throw "GATE_BROKER_CONNECT_TIMEOUT" }
  $stream = $client.GetStream(); $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $false, 4096, $true); $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false), 4096, $true)
  $hello = Read-BrokerMessage $reader 5000 "HELLO"
  if ($hello.type -ne "hello" -or -not (Has-StringProperty $hello "protocol") -or $hello.protocol -ne "moawork-full-gate-v1") { throw "GATE_BROKER_HELLO_SCHEMA" }
  Send-Broker $writer @{ type = "acquire"; request = @{ requestId = $payload.requestId; pid = $PID; label = $payload.label } }
  $grant = $null; $waitDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + [int64]$payload.waitTimeoutMs
  while ($null -eq $grant) {
    if ($wrapper.Exited -or $pipe.Eof) { throw "GATE_WRAPPER_LOST_BEFORE_FENCE" }
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $waitDeadline) { throw "GATE_LEASE_TIMEOUT" }
    # Broker heartbeat is fixed at 30s. A 90s read deadline leaves two full
    # heartbeat intervals of scheduling jitter and cannot be weakened by env.
    $message = Read-BrokerMessage $reader 90000 "WAIT"
    if ($message.type -eq "granted") {
      if (-not (Has-StringProperty $message "requestId") -or -not (Equals-OrdinalString $message.requestId $payload.requestId) -or -not (Has-StringProperty $message "leaseToken") -or -not $message.leaseToken) { throw "GATE_BROKER_WAIT_SCHEMA" }
      $grant = $message
    }
    elseif ($message.type -eq "waiting") {
      if (-not (Has-StringProperty $message "requestId") -or -not (Equals-OrdinalString $message.requestId $payload.requestId)) { throw "GATE_BROKER_WAIT_SCHEMA" }
      Write-Structured "GATE_LEASE_WAIT" @{ position = $message.position; waitedMs = $message.waitedMs }
    }
    elseif ($message.type -eq "heartbeat") {
      if (-not (Has-StringProperty $message "requestId") -or -not (Equals-OrdinalString $message.requestId $payload.requestId)) { throw "GATE_BROKER_WAIT_SCHEMA" }
    }
    elseif ($message.type -eq "error") {
      if (-not (Has-StringProperty $message "code")) { throw "GATE_BROKER_WAIT_SCHEMA" }
      throw "GATE_BROKER_REJECTED"
    }
    else { throw "GATE_BROKER_WAIT_SCHEMA" }
  }

  $stage = "fence"
  while (-not $fenceOwned) {
    if ($wrapper.Exited -or $pipe.Eof) { throw "GATE_WRAPPER_LOST_BEFORE_FENCE" }
    try { $fenceOwned = $fence.WaitOne(50) } catch [Threading.AbandonedMutexException] { $fenceOwned = $true; Quarantine "abandoned-machine-fence" }
  }
  Assert-NoFenceMarker ([string]$payload.fenceName)
  $markerCreatedAt = Set-FenceMarker ([string]$payload.fenceName); $markerOwned = $true
  Write-Structured "GATE_FENCE_ACQUIRED" @{ fenceName = $payload.fenceName; bootIdentity = [MoaWorkProcessHandle]::BootIdentity() }
  [Environment]::SetEnvironmentVariable("MOAWORK_GATE_LEASE_TOKEN", [string]$grant.leaseToken, "Process")
  [Environment]::SetEnvironmentVariable("MOAWORK_GATE_LEASE_HOST", "127.0.0.1", "Process")
  [Environment]::SetEnvironmentVariable("MOAWORK_GATE_LEASE_PORT", [string]$payload.port, "Process")
  if ($hasFault -and $payload.testFault -eq "stall-before-command") { Start-Sleep -Seconds 60 }
  if ($wrapper.Exited -or $pipe.Eof) { throw "GATE_WRAPPER_LOST_BEFORE_COMMAND" }
  $stage = "command"
  $job = [MoaWorkGateJob]::Start([string]$payload.command, [string[]]$payload.args, [string]$payload.cwd)
  [void](Set-FenceMarker ([string]$payload.fenceName) $job $markerCreatedAt)
  Write-Structured "GATE_LEASE_ACQUIRED" @{ ownerPid = $PID; commandPid = $job.ProcessId; commandCreationIdentity = $job.CreationIdentity; bootIdentity = [MoaWorkProcessHandle]::BootIdentity() }
  $deadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + [int64]$payload.runTimeoutMs; $result = ""; $signal = ""; $exitCode = $null
  while (-not $result) {
    $controlLine = $null
    if ($pipe.TryRead([ref]$controlLine)) {
      try { $control = $controlLine | ConvertFrom-Json } catch { $result = "malformed-control" }
      if (-not $result -and -not (Has-StringProperty $control "nonce")) { throw "GATE_PIPE_CONTROL_SCHEMA" }
      if (-not $result -and (Equals-OrdinalString $control.nonce $PipeNonce) -and $control.type -eq "signal" -and $control.signal -in @("SIGINT", "SIGTERM")) { $result = "signal"; $signal = $control.signal }
      elseif (-not $result) { throw "GATE_PIPE_CONTROL_SCHEMA" }
    } elseif ($pipe.Eof -or $wrapper.Exited) { $result = "wrapper-eof" }
    elseif ($null -eq $exitCode -and $job.PrimaryExited) { $exitCode = [int]$job.CaptureExitAndClosePrimary() }
    elseif ($null -ne $exitCode -and $job.ActiveProcesses -eq 0) { $result = "exit" }
    elseif ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $deadline) { $result = "timeout" }
    else { Start-Sleep -Milliseconds 25 }
  }
  if ($result -ne "exit") { $job.Terminate(78) }
  $injectHang = $hasFault -and $payload.testFault -eq "cleanup-hang"
  if (-not (Wait-Zero $job 5000 $injectHang)) { Quarantine "cleanup-unverified:$result" }
  if ($result -eq "timeout") { $exitCode = 124; Fail "GATE_LEASE_RUN_TIMEOUT" "gate command timed out" @{ activeProcesses = 0 } }
  elseif ($result -eq "signal") { $exitCode = if ($signal -eq "SIGINT") { 130 } else { 143 }; Write-Structured "GATE_LEASE_INTERRUPTED" @{ signal = $signal; activeProcesses = 0 } }
  elseif ($result -ne "exit") { $exitCode = 78; Fail "GATE_GUARDIAN_TRANSPORT_LOST" "wrapper IPC closed" @{ activeProcesses = 0 } }
  $commandResultVerified = $result -eq "exit" -and $null -ne $exitCode
  $stage = "release"
  if ($hasFault -and $payload.testFault -eq "release-write-failure") { $client.Close() }
  Send-Broker $writer @{ type = "release"; requestId = $payload.requestId }
  $releaseDeadline = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 5000; $released = $false
  while (-not $released -and [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -lt $releaseDeadline) {
    $reply = Read-BrokerMessage $reader 5000 "RELEASE"
    if ($reply.type -eq "released" -and (Has-StringProperty $reply "requestId") -and (Equals-OrdinalString $reply.requestId $payload.requestId)) { $released = $true }
    elseif ($reply.type -eq "heartbeat" -and (Has-StringProperty $reply "requestId") -and (Equals-OrdinalString $reply.requestId $payload.requestId)) {}
    elseif ($reply.type -eq "error" -and (Has-StringProperty $reply "code")) { throw "GATE_BROKER_RELEASE_REJECTED" }
    else { throw "GATE_BROKER_RELEASE_SCHEMA" }
  }
  if (-not $released) { throw "GATE_BROKER_RELEASE_TIMEOUT" }
  Remove-FenceMarker ([string]$payload.fenceName); $markerOwned = $false
  $fence.ReleaseMutex(); $fenceOwned = $false
  Send-Broker $writer @{ type = "release-complete"; requestId = $payload.requestId }
  Close-Broker $client; $client = $null
  Write-Structured "GATE_LEASE_RELEASED" @{ childExitCode = $exitCode; activeProcesses = 0; bootIdentity = [MoaWorkProcessHandle]::BootIdentity() }
  exit $exitCode
} catch {
  $reason = [string]$_.Exception.Message
  $releaseTransportFailure = $reason -in @(
    "GATE_BROKER_WRITE_FAILED",
    "GATE_BROKER_READ_FAILED",
    "GATE_BROKER_RELEASE_EOF",
    "GATE_BROKER_CLOSE_FAILED"
  )
  if ($stage -eq "release" -and $commandResultVerified -and $releaseTransportFailure) {
    if (-not (Wait-Zero $job 5000 $false)) { Quarantine "release-result-cleanup-unverified:$reason" }
    if ($markerOwned) {
      try { Remove-FenceMarker ([string]$payload.fenceName); $markerOwned = $false }
      catch { Quarantine "marker-cleanup-failed" }
    }
    if ($fenceOwned) {
      try { $fence.ReleaseMutex(); $fenceOwned = $false }
      catch { Quarantine "fence-release-failed" }
    }
    Write-ReleaseDegraded $reason ([int]$exitCode)
    exit $exitCode
  }
  if ($null -ne $job) { try { $job.Terminate(78) } catch {}; if (-not (Wait-Zero $job 5000 $false)) { Quarantine "exception-cleanup:$reason" } }
  if ($markerOwned) { try { Remove-FenceMarker ([string]$payload.fenceName); $markerOwned = $false } catch { Quarantine "marker-cleanup-failed" } }
  if ($fenceOwned) { try { $fence.ReleaseMutex(); $fenceOwned = $false } catch { Quarantine "fence-release-failed" } }
  $code = if ($reason.StartsWith("GATE_")) { $reason } else { "GATE_GUARDIAN_INTERNAL" }
  Fail $code "Windows guardian failed closed" @{ stage = $stage; reason = $reason }
  exit 78
} finally {
  if ($null -ne $job) { $job.Dispose() }
  if ($null -ne $client) { $client.Dispose() }
  if ($null -ne $fence) { $fence.Dispose() }
  if ($null -ne $pipe) { $pipe.Dispose() }
  if ($null -ne $wrapper) { $wrapper.Dispose() }
}
