import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/039_feature_flag_lifecycle.sql"),
  "utf8",
);

const required = [
  "platform_register_feature_flag",
  "platform_advance_feature_flag",
  "revoke execute on function public.platform_set_feature_release(uuid, text, text, boolean, text)",
  "platform_emergency_disable_feature",
  "platform_retire_feature_flag",
  "list_feature_flag_debt",
  "release_rings_require_operator()",
];

const missing = required.filter((token) => !migration.includes(token));
if (missing.length > 0) {
  console.error(`feature flag contract missing: ${missing.join(", ")}`);
  process.exit(1);
}

if (!migration.includes("removal_due_at") || !migration.includes("feature_emergency_off")) {
  console.error("feature flag debt or emergency rollback contract missing");
  process.exit(1);
}

console.log("feature flag release contract: PASS");
