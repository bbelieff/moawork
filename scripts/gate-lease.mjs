#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  DEFAULT_GATE_LEASE_HOST,
  DEFAULT_GATE_LEASE_PORT,
  GateLeaseError,
  verifyGateLease,
} from "./gate-lease-core.mjs";
import { runGateCommand } from "./gate-lease-runner.mjs";

function structured(kind, detail) {
  console.error(`${kind} ${JSON.stringify(detail)}`);
}

function isWslRuntime() {
  if (process.platform !== "linux") return false;
  try {
    return Boolean(process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME)
      || /microsoft|wsl/iu.test(readFileSync("/proc/sys/kernel/osrelease", "utf8"));
  } catch {
    return false;
  }
}

function fail(error) {
  const safe = error instanceof GateLeaseError ? error : new GateLeaseError("GATE_LEASE_INTERNAL", String(error));
  structured("GATE_LEASE_FAILURE", { code: safe.code, message: safe.message, detail: safe.detail });
  return 78;
}

if (process.argv.includes("--test-endpoint")) {
  process.exit(fail(new GateLeaseError("GATE_TEST_ENDPOINT_REMOVED", "test endpoints are not part of the production CLI")));
}
if (isWslRuntime()) {
  process.exit(
    fail(new GateLeaseError(
      "GATE_LEASE_WSL_HOST_REQUIRED",
      "WSL Linux Node cannot own a broker; route through the Windows host Node guardian",
    )),
  );
}
if (process.platform !== "win32") {
  process.exit(
    fail(new GateLeaseError(
      "GATE_POSIX_CONTAINMENT_UNAVAILABLE",
      "cgroup v2/pidfd/subreaper containment is unavailable in this standard entrypoint",
    )),
  );
}

const args = process.argv.slice(2);
if (args.includes("--verify-held")) {
  const valid = await verifyGateLease({
    host: DEFAULT_GATE_LEASE_HOST,
    port: DEFAULT_GATE_LEASE_PORT,
    leaseToken: process.env.MOAWORK_GATE_LEASE_TOKEN,
  });
  if (!valid) structured("GATE_LEASE_FAILURE", { code: "GATE_LEASE_TOKEN_INVALID" });
  process.exit(valid ? 0 : 79);
}

const separator = args.indexOf("--");
if (separator < 0 || !args[separator + 1]) {
  console.error("Usage: node scripts/gate-lease.mjs -- <executable> [args...]");
  process.exit(64);
}

try {
  const code = await runGateCommand({
    command: args[separator + 1],
    args: args.slice(separator + 2),
  });
  process.exit(code);
} catch (error) {
  process.exit(fail(error));
}
