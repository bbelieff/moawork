#!/usr/bin/env node
import {
  createLeaseBroker,
  DEFAULT_DIAGNOSTIC_INTERVAL_MS,
  DEFAULT_GATE_LEASE_HOST,
  DEFAULT_GATE_LEASE_PORT,
  probeLeaseBroker,
} from "./gate-lease-core.mjs";

const host = DEFAULT_GATE_LEASE_HOST;
const port = DEFAULT_GATE_LEASE_PORT;
const diagnosticIntervalMs = DEFAULT_DIAGNOSTIC_INTERVAL_MS;
const idleTimeoutMs = 10_000;

try {
  await createLeaseBroker({ host, port, diagnosticIntervalMs, idleTimeoutMs });
} catch (error) {
  if (error?.code === "EADDRINUSE") {
    const existing = await probeLeaseBroker({ host, port });
    process.exit(existing.available ? 0 : 76);
  }
  process.exit(76);
}
