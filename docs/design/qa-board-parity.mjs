/* Actual app parity gate for product default boards. The mockup self-check lives in qa-mockup.mjs. */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadAppContract, loadParityOverrides } from "./qa-app.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const requested = process.argv.slice(2);
const scopes = requested.length ? requested : ["new", "contact"];
const allowed = new Set(["new", "contact"]);
if (scopes.some((scope) => !allowed.has(scope))) throw new Error("qa-board-parity supports: new contact");

const app = loadAppContract();
const overrides = loadParityOverrides();
const failures = [];
const requireOverride = (scope) => {
  if (!overrides.some((entry) => entry.scope === scope)) failures.push(`${scope}: issue/date/rationale override 없음`);
};

for (const scope of scopes) {
  requireOverride(scope);
  const tab = app.tabs.get(scope);
  if (!tab) { failures.push(`${scope}: actual DefaultTab 없음`); continue; }
  if (scope === "new") {
    if (tab.columns.length !== 22) failures.push(`new: columns ${tab.columns.length}/22`);
    const visibleGroups = tab.groups.map((group) => group.name.replace(/^[^가-힣A-Za-z0-9]+\s*/, ""));
    if (visibleGroups.join("|") !== "신규고객|2차 상담고객|1차 부재|보류|거절") failures.push("new: explicit group order 불일치");
    if (Object.keys(tab.columns.find((column) => column.key === "consult_status")?.moveTo ?? {}).length !== 6) failures.push("new: move rules 6 아님");
  }
  if (scope === "contact") {
    if (tab.columns.length !== 21) failures.push(`contact: columns ${tab.columns.length}/21`);
    if (tab.groups.filter((group) => group.assigneeSlot !== undefined).length !== 2) failures.push("contact: dynamic member groups 불일치");
    const linked = tab.columns.filter((column) => column.source === "lk");
    if (linked.some((column) => column.readOnly === true)) failures.push("contact: linked provenance가 편집 잠금됨");
    const transition = tab.transitions.find((entry) => entry.columnKey === "work_move");
    if (!transition || transition.guard?.columnKey !== "seal_status") failures.push("contact: transition seal guard 상실");
  }
  const pinned = tab.columns.filter((column) => column.rightPinned);
  if (pinned.length !== 1) failures.push(`${scope}: pinned workflow gate ${pinned.length}/1`);
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

const runtime = spawnSync(process.execPath, [path.join(ROOT, "node_modules/vitest/vitest.mjs"), "run", "src/lib/default-tabs/board-parity.contract.test.ts"], {
  cwd: path.join(ROOT, "app"),
  stdio: "inherit",
  env: { ...process.env, QA_BOARD_SCOPES: scopes.join(",") },
});
if (runtime.status !== 0) process.exit(runtime.status ?? 2);
console.log(`qa-board-parity ${scopes.join(" ")}: 0 unexplained diffs`);
