#!/usr/bin/env node

// There is intentionally no PID/PGID fallback here. On Linux a correct release
// requires cgroup v2 + pidfd/subreaper ownership of every descendant. Standard
// MoaWork full gates run on the Windows self-hosted machine; WSL is routed back
// through that host guardian. Any direct POSIX entry fails closed.
console.error(
  'GATE_LEASE_FAILURE {"code":"GATE_POSIX_CONTAINMENT_UNAVAILABLE","message":"cgroup v2/pidfd/subreaper guardian is unavailable"}',
);
process.exit(78);
