import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyOtherInfoValue, updateOtherInfoEntry } from "@/lib/boards/structured-field";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  revalidate: vi.fn(),
  getBoardDetail: vi.fn(),
  getItem: vi.fn(),
  setCells: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "user-a" } })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.permission }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: vi.fn(async () => ({
    service: { getBoardDetail: mocks.getBoardDetail, getItem: mocks.getItem, setCells: mocks.setCells },
  })),
}));

import { INITIAL_OTHER_INFO_SAVE_STATE } from "./other-info-action-state";
import { saveOtherInfoAction } from "./other-info-actions";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";

function form(value: unknown, fieldKey = "other_info") {
  const data = new FormData();
  data.set("requestId", REQUEST_ID);
  data.set("boardId", "board-a");
  data.set("itemId", "item-a");
  data.set("fieldKey", fieldKey);
  data.set("value", JSON.stringify(value));
  return data;
}

describe("Issue #601 other-info server action", () => {
  beforeEach(() => {
    mocks.permission.mockReset().mockResolvedValue({ kind: "allowed" });
    mocks.revalidate.mockReset();
    mocks.getBoardDetail.mockReset().mockResolvedValue({
      columns: [{ key: "other_info", type: "other_info" }, { key: "custom_other_info", type: "other_info" }],
    });
    mocks.getItem.mockReset().mockResolvedValue({ values: {} });
    mocks.setCells.mockReset().mockResolvedValue({ errors: [] });
  });

  it("writes one strict cell through the request-scoped service", async () => {
    const value = updateOtherInfoEntry(emptyOtherInfoValue(), "intellectualProperty", {
      checked: true,
      text: "특허 2건",
    });
    await expect(saveOtherInfoAction(INITIAL_OTHER_INFO_SAVE_STATE, form(value))).resolves.toEqual({
      ok: true,
      message: "저장됐어요.",
      requestId: REQUEST_ID,
      attempt: 1,
    });
    expect(mocks.setCells).toHaveBeenCalledWith(
      expect.objectContaining({ org: { id: "org-a" } }),
      "board-a",
      "item-a",
      { other_info: value },
    );
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-a");
  });

  it("rejects malformed/future input and denied permission before mutation", async () => {
    const malformed = { ...emptyOtherInfoValue(), future: true };
    expect((await saveOtherInfoAction(INITIAL_OTHER_INFO_SAVE_STATE, form(malformed))).ok).toBe(false);
    expect(mocks.setCells).not.toHaveBeenCalled();

    mocks.permission.mockResolvedValue({ kind: "denied", reason: "permission" });
    expect((await saveOtherInfoAction(INITIAL_OTHER_INFO_SAVE_STATE, form(emptyOtherInfoValue()))).message)
      .toBe("이 항목을 수정할 권한이 없어요.");
    expect(mocks.getItem).not.toHaveBeenCalled();
    expect(mocks.setCells).not.toHaveBeenCalled();
  });

  it("replay of the same durable value is idempotent and writes zero cells", async () => {
    const value = emptyOtherInfoValue();
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    mocks.getItem.mockResolvedValue({ values: { other_info: reordered } });
    expect((await saveOtherInfoAction(INITIAL_OTHER_INFO_SAVE_STATE, form(value))).ok).toBe(true);
    expect(mocks.setCells).not.toHaveBeenCalled();
  });

  it("writes and replays the requested live custom column without touching canonical other_info", async () => {
    const canonical = updateOtherInfoEntry(emptyOtherInfoValue(), "export", { checked: true, text: "정본" });
    const custom = updateOtherInfoEntry(emptyOtherInfoValue(), "certifications", { checked: true, text: "ISO" });
    mocks.getItem.mockResolvedValue({ values: { other_info: canonical } });

    expect((await saveOtherInfoAction(INITIAL_OTHER_INFO_SAVE_STATE, form(custom, "custom_other_info"))).ok).toBe(true);
    expect(mocks.setCells).toHaveBeenCalledWith(
      expect.objectContaining({ org: { id: "org-a" } }),
      "board-a",
      "item-a",
      { custom_other_info: custom },
    );
    expect(mocks.setCells.mock.calls[0]?.[3]).not.toHaveProperty("other_info");

    mocks.setCells.mockClear();
    mocks.getItem.mockResolvedValue({ values: { other_info: canonical, custom_other_info: custom } });
    expect((await saveOtherInfoAction(INITIAL_OTHER_INFO_SAVE_STATE, form(custom, "custom_other_info"))).ok).toBe(true);
    expect(mocks.setCells).not.toHaveBeenCalled();
  });

  it("fails closed when the requested live column is absent or not other_info", async () => {
    mocks.getBoardDetail.mockResolvedValue({ columns: [{ key: "custom_other_info", type: "text" }] });
    const result = await saveOtherInfoAction(
      INITIAL_OTHER_INFO_SAVE_STATE,
      form(emptyOtherInfoValue(), "custom_other_info"),
    );
    expect(result).toMatchObject({ ok: false, message: "기타정보 컬럼을 찾을 수 없어요." });
    expect(mocks.setCells).not.toHaveBeenCalled();
  });

  it("returns the single-cell failure without a success revalidation", async () => {
    mocks.setCells.mockResolvedValue({
      errors: [{ key: "other_info", label: "기타정보", message: "저장 실패" }],
    });
    const result = await saveOtherInfoAction(INITIAL_OTHER_INFO_SAVE_STATE, form(emptyOtherInfoValue()));
    expect(result).toMatchObject({ ok: false, message: "저장 실패", requestId: REQUEST_ID });
    expect(mocks.setCells).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
