#!/usr/bin/env node
import { runGateCommand } from "./gate-lease-runner.mjs";

const config = JSON.parse(Buffer.from(process.argv[2], "base64url").toString("utf8"));
const separator = process.argv.indexOf("--");
const code = await runGateCommand({
  ...config,
  command: process.argv[separator + 1],
  args: process.argv.slice(separator + 2),
  ensureBroker: false,
});
process.exit(code);
