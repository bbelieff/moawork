import { describe, expect, it } from "vitest";
import type { BoardColumn } from "./types";
import {
  applyBoardSummarySettingsIntent,
  parseBoardSummaryConfig,
  parseBoardSummarySettingsRequest,
} from "./summary-settings";
import { boardSummaryCandidates } from "./summary";
import { LocalBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { db, resetDb } from "@/lib/repo/local/store";
import { SEED_BOARD_NEW_LEAD, SEED_ORG_ID, SEED_USER_MEMBER, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import type { Ctx } from "@/lib/types";

function column(key: string, type: BoardColumn["type"], extra: Partial<BoardColumn> = {}): BoardColumn {
  return { id: key, org_id: "org", board_id: "board", key, label: key, type, source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null, ...extra };
}

const columns = [column("status", "status"), column("amount", "money"), column("quantity", "number")];
const request = (intent: unknown) => ({ requestId: "00000000-0000-4000-8000-000000000001", intent });

describe("Issue #605 summary settings contract", () => {
  it("accepts only exact config and intent schemas", () => {
    expect(parseBoardSummaryConfig([{ id: "status", kind: "distribution", columnKey: "status" }])).toHaveLength(1);
    expect(() => parseBoardSummaryConfig([{ id: "status", kind: "distribution", columnKey: "status", extra: true }])).toThrow();
    expect(() => parseBoardSummaryConfig([
      { id: "same", kind: "distribution", columnKey: "status" },
      { id: "same", kind: "sum", columnKey: "amount" },
    ])).toThrow(/중복/);
    expect(() => parseBoardSummarySettingsRequest({ ...request({ type: "remove", metricId: "status" }), extra: true })).toThrow();
    expect(() => parseBoardSummarySettingsRequest(request({ type: "move", metricId: "status", direction: 0 }))).toThrow();
  });

  it("adds, removes and orders no more than three metrics", () => {
    const one = applyBoardSummarySettingsIntent([], request({ type: "add", metric: { id: "status", kind: "distribution", columnKey: "status" } }), columns);
    const two = applyBoardSummarySettingsIntent(one, request({ type: "add", metric: { id: "amount", kind: "sum", columnKey: "amount" } }), columns);
    const moved = applyBoardSummarySettingsIntent(two, request({ type: "move", metricId: "amount", direction: -1 }), columns);
    expect(moved.map((entry) => entry.id)).toEqual(["amount", "status"]);
    expect(applyBoardSummarySettingsIntent(moved, request({ type: "remove", metricId: "status" }), columns).map((entry) => entry.id)).toEqual(["amount"]);
    const three = applyBoardSummarySettingsIntent(two, request({ type: "add", metric: { id: "quantity", kind: "sum", columnKey: "quantity" } }), columns);
    expect(() => applyBoardSummarySettingsIntent(three, request({ type: "add", metric: { id: "four", kind: "sum", columnKey: "quantity" } }), columns)).toThrow(/최대 3개/);
  });

  it("fails closed on duplicate, hidden, archived, missing and mistyped targets", () => {
    const current = [{ id: "status", kind: "distribution" as const, columnKey: "status" }];
    expect(() => applyBoardSummarySettingsIntent(current, request({ type: "add", metric: { id: "copy", kind: "distribution", columnKey: "status" } }), columns)).toThrow(/중복/);
    expect(() => applyBoardSummarySettingsIntent([], request({ type: "add", metric: { id: "hidden", kind: "sum", columnKey: "amount" } }), [column("amount", "money", { summary_hidden: true })])).toThrow(/사용할 수 없는/);
    expect(() => applyBoardSummarySettingsIntent([], request({ type: "add", metric: { id: "gone", kind: "sum", columnKey: "amount" } }), [column("amount", "money", { archived_at: "now" })])).toThrow(/사용할 수 없는/);
    expect(() => applyBoardSummarySettingsIntent([], request({ type: "add", metric: { id: "wrong", kind: "sum", columnKey: "status" } }), columns)).toThrow(/사용할 수 없는/);
  });

  it("keeps physical NCB/KCB candidates and never invents the synthetic presentation key", () => {
    const physical = [
      column("credit_score_ncb", "number"),
      column("credit_score_kcb", "number"),
      column("view_hidden_amount", "money"),
    ];
    const candidates = boardSummaryCandidates(physical, []);
    expect(candidates.map((entry) => entry.columnKey)).toEqual([
      "credit_score_ncb", "credit_score_kcb", "view_hidden_amount",
    ]);
    expect(candidates.some((entry) => entry.columnKey === "credit_scores")).toBe(false);
  });

  it("removes stale targets one by one while stale move and new ineligible add fail closed", () => {
    const stale = [
      { id: "hidden", kind: "sum" as const, columnKey: "amount" },
      { id: "missing", kind: "sum" as const, columnKey: "gone" },
      { id: "drift", kind: "sum" as const, columnKey: "status" },
    ];
    const changed = [column("status", "status"), column("amount", "money", { summary_hidden: true })];
    expect(() => applyBoardSummarySettingsIntent(stale, request({ type: "move", metricId: "hidden", direction: 1 }), changed)).toThrow(/사용할 수 없는/);
    const afterHidden = applyBoardSummarySettingsIntent(stale, request({ type: "remove", metricId: "hidden" }), changed);
    expect(afterHidden.map((entry) => entry.id)).toEqual(["missing", "drift"]);
    const afterMissing = applyBoardSummarySettingsIntent(afterHidden, request({ type: "remove", metricId: "missing" }), changed);
    expect(afterMissing.map((entry) => entry.id)).toEqual(["drift"]);
    expect(applyBoardSummarySettingsIntent(afterMissing, request({ type: "remove", metricId: "drift" }), changed)).toEqual([]);
    expect(() => applyBoardSummarySettingsIntent([], request({ type: "add", metric: stale[0] }), changed)).toThrow(/사용할 수 없는/);
  });

  it("binds Local replay receipts to the actor like hosted", () => {
    resetDb();
    const state = db();
    const org = state.orgs.find((entry) => entry.id === SEED_ORG_ID)!;
    const ctx = (userId: string): Ctx => ({
      user: state.users.find((entry) => entry.id === userId)!, org, role: "owner", scope: "all",
    });
    const repo = new LocalBoardsRepo();
    const target = repo.listColumns(ctx(SEED_USER_OWNER), SEED_BOARD_NEW_LEAD).find((entry) => entry.type === "number")!;
    const replayRequest = parseBoardSummarySettingsRequest(request({ type: "add", metric: { id: "score", kind: "sum", columnKey: target.key } }));
    expect(repo.applyBoardSummarySettings(ctx(SEED_USER_OWNER), SEED_BOARD_NEW_LEAD, replayRequest).replayed).toBe(false);
    expect(() => repo.applyBoardSummarySettings(ctx(SEED_USER_MEMBER), SEED_BOARD_NEW_LEAD, replayRequest)).toThrow(/다른 변경/);
  });
});
