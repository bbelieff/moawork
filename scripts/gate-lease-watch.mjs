#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commandPid = Number(process.argv[2]);
if (!Number.isInteger(commandPid) || commandPid <= 0) process.exit(64);

let closing = false;
function stopOrphanedCommandTree() {
  if (closing) return;
  closing = true;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(commandPid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-commandPid, "SIGKILL");
    } catch {
      // The command already exited normally.
    }
  }
  process.exit(0);
}

process.stdin.resume();
process.stdin.once("end", stopOrphanedCommandTree);
process.stdin.once("error", stopOrphanedCommandTree);
