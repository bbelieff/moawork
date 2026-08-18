import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOARD_ACTION_FLASH_COOKIE, decodeBoardActionFlash, findBoardActionError } from "@/lib/boards/boardActionFlash";
import { CELL_FLASH_COOKIE, decodeCellFlash } from "@/lib/boards/cellFlash";

// BBE-201 — 「새 항목 + 필드 채우기」 실패가 «전면 오류 화면» 으로 튀지 않는다.
//
// 총괄 실측: 「보드 좌측 하단 새항목 누르고 필드 채우면 에러가 나버림」 → This page couldn't load.
// 서버 액션이 던지면 Next 오류 경계가 화면을 통째로 덮는다. 사용자는 무엇이 왜 안 됐는지
// 모르고 입력하던 것도 잃는다.
//
// ★ 이 파일이 고정하는 것은 «원인» 이 아니라 «실패의 모양» 이다.
//   원인이 트리거든 권한이든 입력이든, 어느 쪽이어도 화면 안에서 말해야 한다.
//
// ★ 그리고 사실을 뭉개지 않는다 — 권한 없음 / 확인 불가 / 입력 오류 / 저장 실패는
//   사용자에게 «서로 다른 사실» 이다. requirePermission 은 이미 그 문장을 만들어 놓고
//   throw 로 버리고 있었다(BBE-193·BBE-204 와 같은 족보).

const createItem = vi.fn(async () => ({ id: "item-1" }));
const setCells = vi.fn(async () => ({ errors: [] as unknown[] }));
const cookieSet = vi.fn();
const guard: { kind: string; reason?: string } = { kind: "allowed" };
const risky: { ok: boolean } = { ok: true };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ org: { id: "org-1" }, user: { id: "owner-1" }, role: "owner", scope: "all" }),
  applyAs: (ctx: unknown) => ctx,
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: async () => guard }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: async () => risky }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: async () => ({ service: { createItem, setCells }, client: {}, repo: {} }) }));

import { addItemAction, setCellAction } from "./actions";

function form(title = "새 항목"): FormData {
  const fd = new FormData();
  fd.set("boardId", "board-1");
  fd.set("groupId", "");
  fd.set("title", title);
  return fd;
}

/** 이번 호출에서 실제로 심어진 플래시. */
function flashed() {
  const call = [...cookieSet.mock.calls].reverse().find(([name]) => name === BOARD_ACTION_FLASH_COOKIE);
  return call ? decodeBoardActionFlash(call[1] as string) : null;
}

/**
 * «지금 화면에 그려질» 오류 — 마지막으로 쓰인 쿠키 값을 화면과 같은 방식으로 읽는다.
 * 성공이 이전 실패를 지웠는지 보려면 «새로 심긴 것» 이 아니라 «남아 있는 것» 을 봐야 한다.
 */
function surviving(): string | null {
  const call = [...cookieSet.mock.calls].reverse().find(([name]) => name === BOARD_ACTION_FLASH_COOKIE);
  return call ? findBoardActionError(decodeBoardActionFlash(call[1] as string), "board-1") : null;
}

describe("BBE-201 addItemAction 은 실패를 화면 안에서 말한다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 원인은 서버 로그로 남기는 것이 «의도된 동작» 이다(조사 수단을 없애지 않는다).
    // 테스트 출력만 조용히 시킨다 — 로그를 없애는 게 아니다.
    vi.spyOn(console, "error").mockImplementation(() => {});
    guard.kind = "allowed";
    delete guard.reason;
    risky.ok = true;
    createItem.mockImplementation(async () => ({ id: "item-1" }));
  });

  // 되돌리면 빨개진다: requirePermission 의 throw 를 그대로 두기
  it("① 권한 없음 — 던지지 않고 «권한이 없다» 고 말한다", async () => {
    guard.kind = "denied";
    guard.reason = "permission";

    await expect(addItemAction(form())).resolves.toBeUndefined();
    expect(flashed()?.message).toContain("권한이 없어요");
    expect(createItem).not.toHaveBeenCalled();
  });

  // ★ 되돌리면 빨개진다: 권한 없음과 확인 불가를 같은 문장으로 뭉개기
  it("② 확인 불가 — 던지지 않고 «권한 없음» 과 «다른» 사실을 말한다", async () => {
    guard.kind = "denied";
    guard.reason = "unavailable";
    await addItemAction(form());
    const unavailable = flashed()?.message ?? "";

    vi.clearAllMocks();
    guard.reason = "permission";
    await addItemAction(form());
    const permission = flashed()?.message ?? "";

    expect(unavailable).toContain("확인하지 못했어요");
    expect(unavailable).not.toBe(permission);
  });

  // 되돌리면 빨개진다: ValidationError 를 그대로 던지기
  it("③ 입력 오류(제목 없음) — 던지지 않고 무엇이 잘못됐는지 말한다", async () => {
    await expect(addItemAction(form(""))).resolves.toBeUndefined();
    expect(flashed()?.message).toBeTruthy();
    expect(createItem).not.toHaveBeenCalled();
  });

  // ★ 되돌리면 빨개진다: DB 오류 메시지를 그대로 사용자에게 내보내기
  it("④ 저장 실패 — 던지지 않고, 원문 DB 오류를 사용자에게 흘리지 않는다", async () => {
    const raw = 'new row violates row-level security policy for table "item_values" (SQLSTATE 42501)';
    createItem.mockImplementation(async () => { throw new Error(raw); });

    await expect(addItemAction(form())).resolves.toBeUndefined();
    const message = flashed()?.message ?? "";
    expect(message).toBeTruthy();
    expect(message).not.toContain("row-level security");
    expect(message).not.toContain("42501");
    expect(message).not.toContain("item_values");
  });

  // ★ 되돌리면 빨개진다: 성공 경로에서 clearFlashCookie 호출을 지우기
  //
  //   이 테스트의 첫 판은 이름은 「성공하면 아무 오류도 남기지 않는다」인데 단언은
  //   «새로 심긴 게 없다» 만 봤다 — «이미 심긴 게 남는지» 는 안 봤다(DC-15 지적).
  //   이름이 단언보다 넓으면 그 테스트는 이름값을 못 한다. 그래서 실제 사용자 순서
  //   (실패 → 고침 → 재시도)를 그대로 재현해 «화면에 남는 것» 을 본다.
  it("⑤ 성공하면 «이전 실패까지» 지운다 — 고친 뒤에 옛 오류가 다시 그려지지 않는다", async () => {
    guard.kind = "denied";
    guard.reason = "permission";
    await addItemAction(form());
    expect(surviving()).toContain("권한이 없어요"); // 실패는 남아야 한다

    guard.kind = "allowed";
    delete guard.reason;
    await addItemAction(form());

    expect(createItem).toHaveBeenCalled();
    expect(surviving()).toBeNull(); // ★ 성공 뒤에는 화면에 아무 오류도 없어야 한다
  });
});

// ── 「필드 채우면 에러」 쪽 — 셀 편집도 같은 규칙을 따른다 ──────────────────────
//
// 총괄 문장이 「새항목 누르고 «필드 채우면»」이라 셀 편집 경로도 함께 고정한다.
// 이쪽은 셀이 특정되므로 보드 전체가 아니라 «그 셀 아래» 에 사유를 붙인다.

function cellForm(): FormData {
  const fd = new FormData();
  fd.set("boardId", "board-1");
  fd.set("itemId", "item-1");
  fd.set("columnKey", "industry");
  fd.set("kind", "text");
  fd.set("value", "제조업");
  return fd;
}

/** 이번 호출에서 셀 플래시로 심어진 값. */
function cellFlashed() {
  const call = [...cookieSet.mock.calls].reverse().find(([name]) => name === CELL_FLASH_COOKIE);
  return call ? decodeCellFlash(call[1] as string) : null;
}

describe("BBE-201 setCellAction 도 실패를 화면 안에서 말한다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.kind = "allowed";
    delete guard.reason;
    vi.spyOn(console, "error").mockImplementation(() => {});
    setCells.mockImplementation(async () => ({ errors: [] }));
  });

  // 되돌리면 빨개진다: setCellAction 의 requirePermission throw 를 그대로 두기
  it("권한 없음 — 던지지 않고 그 셀 아래에 사유를 붙인다", async () => {
    guard.kind = "denied";
    guard.reason = "permission";

    await expect(setCellAction(cellForm())).resolves.toBeUndefined();
    expect(cellFlashed()?.errors[0]?.message).toContain("권한이 없어요");
    expect(setCells).not.toHaveBeenCalled();
  });

  // ★ 되돌리면 빨개진다: setCells 의 DB 오류를 그대로 던지기 (= 전면 오류 화면)
  it("저장 실패 — 던지지 않고, 원문 DB 오류를 흘리지 않는다", async () => {
    setCells.mockImplementation(async () => {
      throw new Error('canonical new lead fields require update_new_lead_fields (SQLSTATE 42501)');
    });

    await expect(setCellAction(cellForm())).resolves.toBeUndefined();
    const message = cellFlashed()?.errors[0]?.message ?? "";
    expect(message).toBeTruthy();
    expect(message).not.toContain("42501");
    expect(message).not.toContain("update_new_lead_fields");
  });

  // ★ 되돌리면 빨개진다: flashCellErrors 의 «담을 것 없으면 지운다» 를 return 으로 되돌리기
  //
  //   이건 이 PR 이 만든 회귀가 아니라 «원래 있던» 성질이다. 그래도 같이 고친다 —
  //   같은 모양의 쿠키를 하나 더 들이면서 기존 것의 같은 결함을 두면
  //   다음 사람은 「원래 그런가 보다」로 읽는다.
  it("성공하면 그 셀의 이전 오류도 지운다", async () => {
    setCells.mockImplementation(async () => {
      throw new Error("일시적 저장 실패");
    });
    await setCellAction(cellForm());
    expect(cellFlashed()?.errors[0]?.message).toBeTruthy(); // 실패는 남는다

    setCells.mockImplementation(async () => ({ errors: [] }));
    await setCellAction(cellForm());
    expect(cellFlashed()).toBeNull(); // ★ 성공 뒤에는 셀 아래에 아무것도 없어야 한다
  });
});
