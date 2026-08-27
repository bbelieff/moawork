#!/usr/bin/env node

// Kept as a fail-closed compatibility tombstone for stale worktrees. The old
// implementation killed a tree by PID after its owner disappeared, which was
// vulnerable to PID reuse and could release the lease before descendants were
// gone. The guardian now owns an exact process/job handle for the full lifetime.
console.error('GATE_LEASE_FAILURE {"code":"GATE_LEASE_PID_WATCHDOG_RETIRED"}');
process.exit(78);
