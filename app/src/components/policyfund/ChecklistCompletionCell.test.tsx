import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { ChecklistCompletionCell } from "./ChecklistCompletionCell";

test("table completion renders the shared completionOf result", () => {
  const html = renderToStaticMarkup(<ChecklistCompletionCell items={[
    { id: "a", label: "A", checked: true, order: 0 },
    { id: "b", label: "B", checked: false, order: 1 },
  ]} />);
  assert.match(html, /1\/2/);
  assert.match(html, /50%/);
});

test("dashboard and detail both consume the request-scoped persisted checklist", async () => {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const [dashboard, detail, cell, panel] = await Promise.all([
    // BBE-186: 서류 준비 칸은 홈에서 «업무 분석»(/dash)으로 옮겨 갔다. 보증도 따라 옮긴다.
    // ★ BBE-215 — 대시보드 쪽 소비자는 「회사 현황」 절로 옮겨갔다. 단언은 그대로다.
    readFile(path.join(appRoot, "components", "dash", "CompanyStatusSection.tsx"), "utf8"),
    readFile(path.join(appRoot, "app", "(app)", "deals", "[dealId]", "page.tsx"), "utf8"),
    readFile(path.join(appRoot, "components", "policyfund", "ChecklistCompletionCell.tsx"), "utf8"),
    readFile(path.join(appRoot, "components", "policyfund", "ChecklistPanel.tsx"), "utf8"),
  ]);
  assert.match(dashboard, /SupabaseChecklistStore/);
  assert.match(dashboard, /getDealChecklist\(ctx\.org\.id, deal\.id\)/);
  assert.match(dashboard, /<ChecklistCompletionCell/);
  assert.match(detail, /SupabaseChecklistStore/);
  assert.match(detail, /ctx\.org\.id/);
  assert.match(detail, /getDealChecklist\(deal\.id\)/);
  assert.match(cell, /completionOf\(items\)/);
  assert.match(panel, /completionOf\(state\.items\)/);
});
