import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/boards/service";

const {
  getSessionMock,
  loadPermGuardMock,
  createClientMock,
  createRequestBoardsMock,
  updateCanonicalMock,
  setCellsStrictMock,
  getItemMock,
  getBoardDetailMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  loadPermGuardMock: vi.fn(),
  createClientMock: vi.fn(),
  createRequestBoardsMock: vi.fn(),
  updateCanonicalMock: vi.fn(),
  setCellsStrictMock: vi.fn(),
  getItemMock: vi.fn(),
  getBoardDetailMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: loadPermGuardMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: createRequestBoardsMock }));
vi.mock("@/lib/new-lead/mutations", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/new-lead/mutations")>();
  return { ...orig, updateCanonicalNewLead: updateCanonicalMock };
});

import { updateBoardRegionPairAction, updateNewLeadRegionPairAction } from "./region-pair-actions";

const CTX = { org: { id: "org-1" }, user: { id: "actor-1" } };

function editableDetail() {
  return {
    board: { id: "board-1" },
    columns: [
      { key: "sido", label: "시도", is_readonly: false, source: "in" },
      { key: "sigungu", label: "시군구", is_readonly: false, source: "in" },
    ],
    groups: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(CTX);
  loadPermGuardMock.mockResolvedValue({ kind: "allowed" });
  createClientMock.mockResolvedValue({});
  updateCanonicalMock.mockResolvedValue({ deal_id: "deal-1", changed_fields: ["region_sido", "region_sigungu"], replayed: false });
  setCellsStrictMock.mockResolvedValue({ errors: [], committed: "all", commitDetail: null });
  getItemMock.mockResolvedValue({ id: "item-1", board_id: "board-1", deal_id: "deal-1" });
  getBoardDetailMock.mockResolvedValue(editableDetail());
  createRequestBoardsMock.mockResolvedValue({
    service: { setCellsStrict: setCellsStrictMock, getItem: getItemMock, getBoardDetail: getBoardDetailMock },
  });
});

describe("region pair 원자 저장", () => {
  it("신규리드는 두 필드를 한 patch로 저장한다 — 단일 액션 두 번 호출 없음", async () => {
    const result = await updateNewLeadRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      dealId: "deal-1",
      sido: "서울",
      sigungu: "강남구",
    });
    expect(result.ok).toBe(true);
    expect(updateCanonicalMock).toHaveBeenCalledTimes(1);
    expect(updateCanonicalMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ patch: { region_sido: "서울", region_sigungu: "강남구" } }),
    );
  });

  it("시도 변경+시군구 초기화도 한 요청이다", async () => {
    // 기존 강남구를 들고 부산으로 바꾸면 시군구는 빈값으로 함께 저장된다.
    // 호출부는 regionPairForSidoChange로 묶어 오므로 여기서는 결과 pair를 직접 준다.
    const result = await updateNewLeadRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      dealId: "deal-1",
      sido: "부산",
      sigungu: "",
    });
    expect(result.ok).toBe(true);
    expect(updateCanonicalMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ patch: { region_sido: "부산", region_sigungu: null } }),
    );
  });

  it("잘못된 지역쌍은 서버가 거부하고 저장하지 않는다", async () => {
    const bad = await updateNewLeadRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      dealId: "deal-1",
      sido: "서울",
      sigungu: "해운대구",
    });
    expect(bad.ok).toBe(false);
    expect(updateCanonicalMock).not.toHaveBeenCalled();

    const badBoard = await updateBoardRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      sidoKey: "sido",
      sigunguKey: "sigungu",
      sido: "서울",
      sigungu: "해운대구",
    });
    expect(badBoard.ok).toBe(false);
    expect(setCellsStrictMock).not.toHaveBeenCalled();
  });

  it("일반보드는 실제 컬럼 키 두 값을 함께 저장한다", async () => {
    const result = await updateBoardRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      sidoKey: "sido",
      sigunguKey: "sigungu",
      sido: "경기",
      sigungu: "화성시",
    });
    expect(result.ok).toBe(true);
    expect(setCellsStrictMock).toHaveBeenCalledTimes(1);
    expect(setCellsStrictMock).toHaveBeenCalledWith(
      expect.anything(),
      "board-1",
      "item-1",
      { sido: "경기", sigungu: "화성시" },
      expect.any(String),
      ["sido", "sigungu"],
    );
  });

  it("저장 실패는 입력을 유지하라는 메시지와 함께 실패로 닫는다", async () => {
    updateCanonicalMock.mockRejectedValueOnce(new Error("DB 오류"));
    const result = await updateNewLeadRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      dealId: "deal-1",
      sido: "서울",
      sigungu: "강남구",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/입력은 유지/);
  });

  it("권한 없으면 저장하지 않는다", async () => {
    loadPermGuardMock.mockResolvedValueOnce({ kind: "denied", reason: "permission" });
    const result = await updateBoardRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      sidoKey: "sido",
      sigunguKey: "sigungu",
      sido: "서울",
      sigungu: "강남구",
    });
    expect(result.ok).toBe(false);
    expect(setCellsStrictMock).not.toHaveBeenCalled();
  });

  it("strict 실패는 둘 다 쓰지 않은 것으로 닫고 입력을 유지한다", async () => {
    setCellsStrictMock.mockResolvedValueOnce({
      errors: [{ key: "sigungu", label: "시군구", message: "시군구를 추천 목록에서 선택해 주세요." }],
      committed: "none",
      commitDetail: null,
    });
    const result = await updateBoardRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      sidoKey: "sido",
      sigunguKey: "sigungu",
      sido: "서울",
      sigungu: "강남구",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/입력은 유지/);
  });

  it("후처리 실패로 값이 반영된 경우는 미저장으로 꾸미지 않고 재확인을 안내한다", async () => {
    setCellsStrictMock.mockResolvedValueOnce({
      errors: [{ key: "sido", label: "시도", message: "값은 저장됐으나 마무리 확인에 실패했습니다" }],
      committed: "all",
      commitDetail: "값은 저장됐으나 마무리 확인에 실패했습니다",
    });
    const result = await updateBoardRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      sidoKey: "sido",
      sigunguKey: "sigungu",
      sido: "서울",
      sigungu: "강남구",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/새로고침/);
    expect(result.message).not.toMatch(/입력은 유지됩니다/);
  });

  it("post-commit 확인불가(unknown)는 미저장으로 꾸미지 않고 초안유지·재조회·중복쓰기 방지를 안내한다", async () => {
    setCellsStrictMock.mockResolvedValueOnce({
      errors: [
        {
          key: "sido",
          label: "시도",
          message: "저장됐을 수 있으나 방금 저장값을 확인하지 못했습니다 화면을 새로고침해 확인한 뒤 다시 시도해 주세요(확인 전에는 다시 저장하지 마세요).",
        },
      ],
      committed: "unknown",
      commitDetail: "저장됐을 수 있으나 방금 저장값을 확인하지 못했습니다",
    });
    const result = await updateBoardRegionPairAction({
      boardId: "board-1",
      itemId: "item-1",
      sidoKey: "sido",
      sigunguKey: "sigungu",
      sido: "서울",
      sigungu: "강남구",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/저장됐을 수 있으나/);
    expect(result.requiresReload).toBe(true);
    expect(result.message).toMatch(/입력은 유지/);
    expect(result.message).toMatch(/새로고침/);
    expect(result.message).toMatch(/다시 저장하지 마세요/);
    expect(result.message).not.toMatch(/✓ 자동 저장됨/);
  });
});

describe("canonical 인가·컬럼 검증(P1)", () => {
  const validCanonical = () => ({
    boardId: "board-1",
    itemId: "item-1",
    dealId: "deal-1",
    sido: "서울",
    sigungu: "강남구",
  });

  it("위조 board/item은 인가 조회 실패로 거부하고 RPC로 가지 않는다", async () => {
    getItemMock.mockRejectedValueOnce(new NotFoundError("아이템을 찾을 수 없습니다"));
    const result = await updateNewLeadRegionPairAction({ ...validCanonical(), boardId: "board-forged" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/대상을 확인/);
    expect(updateCanonicalMock).not.toHaveBeenCalled();
  });

  it("위조 dealId는 실제 lineage와 다르면 거부하고 실제 deal로 묶는다", async () => {
    getItemMock.mockResolvedValueOnce({ id: "item-1", board_id: "board-1", deal_id: "deal-real" });
    const forged = await updateNewLeadRegionPairAction({ ...validCanonical(), dealId: "deal-forged" });
    expect(forged.ok).toBe(false);
    expect(forged.message).toMatch(/대상을 확인/);
    expect(updateCanonicalMock).not.toHaveBeenCalled();

    getItemMock.mockResolvedValueOnce({ id: "item-1", board_id: "board-1", deal_id: "deal-real" });
    updateCanonicalMock.mockResolvedValueOnce({ deal_id: "deal-real", changed_fields: ["region_sido"], replayed: false });
    const valid = await updateNewLeadRegionPairAction({ ...validCanonical(), dealId: "deal-real" });
    expect(valid.ok).toBe(true);
    expect(updateCanonicalMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dealId: "deal-real", patch: { region_sido: "서울", region_sigungu: "강남구" } }),
    );
  });

  it("deal lineage가 없으면 거부한다", async () => {
    getItemMock.mockResolvedValueOnce({ id: "item-1", board_id: "board-1", deal_id: null });
    const result = await updateNewLeadRegionPairAction(validCanonical());
    expect(result.ok).toBe(false);
    expect(updateCanonicalMock).not.toHaveBeenCalled();
  });

  it("어느 한쪽이 readonly여도 RPC 전에 거부한다", async () => {
    getBoardDetailMock.mockResolvedValueOnce({
      board: { id: "board-1" },
      columns: [
        { key: "sido", label: "시도", is_readonly: true, source: "in" },
        { key: "sigungu", label: "시군구", is_readonly: false, source: "in" },
      ],
      groups: [],
    });
    const sidoLocked = await updateNewLeadRegionPairAction(validCanonical());
    expect(sidoLocked.ok).toBe(false);
    expect(sidoLocked.message).toMatch(/손으로 고칠 수 없습니다/);

    getBoardDetailMock.mockResolvedValueOnce({
      board: { id: "board-1" },
      columns: [
        { key: "sido", label: "시도", is_readonly: false, source: "in" },
        { key: "sigungu", label: "시군구", is_readonly: true, source: "in" },
      ],
      groups: [],
    });
    const sigunguLocked = await updateNewLeadRegionPairAction(validCanonical());
    expect(sigunguLocked.ok).toBe(false);
    expect(updateCanonicalMock).not.toHaveBeenCalled();
  });

  it("source 비편집(calc) 컬럼이 끼면 둘 다 쓰지 않는다", async () => {
    getBoardDetailMock.mockResolvedValueOnce({
      board: { id: "board-1" },
      columns: [
        { key: "sido", label: "시도", is_readonly: false, source: "in" },
        { key: "sigungu", label: "시군구", is_readonly: false, source: "calc" },
      ],
      groups: [],
    });
    const result = await updateNewLeadRegionPairAction(validCanonical());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/직접 바꿀 수 없습니다/);
    expect(updateCanonicalMock).not.toHaveBeenCalled();
  });

  it("두 컬럼 중 하나라도 없으면 거부한다", async () => {
    getBoardDetailMock.mockResolvedValueOnce({
      board: { id: "board-1" },
      columns: [{ key: "sido", label: "시도", is_readonly: false, source: "in" }],
      groups: [],
    });
    const result = await updateNewLeadRegionPairAction(validCanonical());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/컬럼 구성/);
    expect(updateCanonicalMock).not.toHaveBeenCalled();
  });

  it("두 컬럼이 모두 편집가능하면 원본 매핑 그대로 한 patch로 저장한다", async () => {
    const result = await updateNewLeadRegionPairAction(validCanonical());
    expect(result.ok).toBe(true);
    expect(getItemMock).toHaveBeenCalledWith(expect.anything(), "board-1", "item-1");
    expect(getBoardDetailMock).toHaveBeenCalledWith(expect.anything(), "board-1");
    expect(updateCanonicalMock).toHaveBeenCalledTimes(1);
    expect(updateCanonicalMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ dealId: "deal-1", patch: { region_sido: "서울", region_sigungu: "강남구" } }),
    );
  });
});
