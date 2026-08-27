#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const POWERSHELL_51 = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const SCRIPT = fileURLToPath(new URL("./gate-lease-recover.ps1", import.meta.url));

if (process.platform !== "win32") {
  console.error(`GATE_LEASE_RECOVERY_FAILURE ${JSON.stringify({ code: "RECOVERY_WINDOWS_HOST_REQUIRED", cleared: false })}`);
  process.exit(78);
}

const child = spawnSync(POWERSHELL_51, [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  SCRIPT,
  ...process.argv.slice(2),
], { stdio: "inherit", windowsHide: true });

if (child.error || child.status === null) {
  console.error(`GATE_LEASE_RECOVERY_FAILURE ${JSON.stringify({ code: "RECOVERY_POWERSHELL_LAUNCH_FAILED", cleared: false })}`);
  process.exit(78);
}
process.exit(child.status);
