#!/usr/bin/env node
import {
  createLeaseBroker,
  DEFAULT_DIAGNOSTIC_INTERVAL_MS,
  DEFAULT_GATE_LEASE_HOST,
  DEFAULT_GATE_LEASE_PORT,
  probeLeaseBroker,
} from "./gate-lease-core.mjs";

const host = process.env.MOAWORK_GATE_LEASE_HOST || DEFAULT_GATE_LEASE_HOST;
const port = Number(process.env.MOAWORK_GATE_LEASE_PORT || DEFAULT_GATE_LEASE_PORT);
const diagnosticIntervalMs = Number(
  process.env.MOAWORK_GATE_DIAGNOSTIC_INTERVAL_MS || DEFAULT_DIAGNOSTIC_INTERVAL_MS,
);
const idleTimeoutMs = Number(process.env.MOAWORK_GATE_BROKER_IDLE_MS || 10_000);

try {
  await createLeaseBroker({ host, port, diagnosticIntervalMs, idleTimeoutMs });
} catch (error) {
  if (error?.code === "EADDRINUSE") {
    const existing = await probeLeaseBroker({ host, port });
    process.exit(existing.available ? 0 : 76);
  }
  process.exit(76);
}
