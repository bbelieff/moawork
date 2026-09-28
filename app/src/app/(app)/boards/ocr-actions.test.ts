import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateCell } from "@/lib/boards/cells";
import { isSourceEditable } from "@/lib/field/source";
import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";

/**
 * saveOcrFieldAction 서버 통합 테스트 — 세션·repo·RPC 경계에서 증명한다.
 *
 * 실제 모듈은 saveOcrFieldAction + saveItemDetailFieldAction(위임 경로)이며,
 * 경계(getSession·supabase·perm·boards 그래프·정본 RPC)만 모킹한다.
 * boards 그래프 fake는 실제 저장 의미를 그대로 둔다:
 * - 정의되지 않은 컬럼은 무시하고 성공을 돌려준다(setCells 실제 동작 —
 *   위조 source가 성공 no-op이던 구멍의 재현 토대).
 * - 읽기전용·validateCell은 실제 함수로 판정한다.
 * - 시스템 보드는 쓰기 전에 던진다(실제 requireEditableBoard 정책).
 */

const mocks = vi.hoisted(() => {
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OWNER = "00000000-0000-4000-8000-000000000010";
  const BOARD = "00000000-0000-4000-8000-000000000020";
  const GROUP = "00000000-0000-4000-8000-000000000030";
  const ITEM = "00000000-0000-4000-8000-000000000031";
  const DEAL = "00000000-0000-4000-8000-000000000040";
  const COMPANY = "00000000-0000-4000-8000-000000000060";
  return {
  ids: { ORG, OWNER, BOARD, GROUP, ITEM, DEAL, COMPANY },
  // 합성 번호 123-45-67891 — 체크섬 통과, 실재 사업자 아님.
  validBizNo: "123-45-67891",
  session: { org: { id: ORG }, user: { id: OWNER }, role: "owner", scope: "all" },
  setValues: vi.fn(),
  setCellsWrites: [] as { key: string; value: unknown }[],
  updateLead: vi.fn(),
  updateMeta: vi.fn(),
  updateTitle: vi.fn(),
  ocrMeta: vi.fn(),
  companyBizNo: vi.fn(),
  companyNameSync: vi.fn(),
  revalidate: vi.fn(),
  dealCompanyId: null as string | null,
  queryErrorTable: null as string | null,
  missingTables: [] as string[],
  };
});

const { ORG, OWNER, BOARD, GROUP, ITEM, DEAL, COMPANY } = mocks.ids;
const VALID_BIZ_NO: string = mocks.validBizNo;

type ColumnDef = {
  key: string;
  label: string;
  type: "text" | "email";
  source: "in" | "calc";
  is_readonly?: boolean;
  options_jsonb: { options: [] } | null;
};

let columnsFixture: ColumnDef[] = [];
let entriesFixture: { key: string; source: "column" | "detail" }[] = [];
let boardSourceFixture: string = NEW_LEAD_TAB_SOURCE;
let isSystemFixture = false;
let itemDealFixture: string | null = DEAL;

function column(key: string, over: Partial<ColumnDef> = {}): ColumnDef {
  return {
    key,
    label: key,
    type: "text",
    source: "in",
    options_jsonb: null,
    ...over,
  };
}

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: vi.fn(async () => ({ kind: "allowed" })) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async (opts?: { noStore?: boolean }) => {
    if (!opts?.noStore) return {};
    return {
      from: (table: string) => {
        // 주입된 조회 오류·행 부재 — loadOcrCurrentAction이 버리지 않고
        // ok:false로 닫는지 증명하는 토대다.
        if (mocks.queryErrorTable === table) {
          const builder: Record<string, unknown> = {};
          builder.select = vi.fn(() => builder);
          builder.eq = vi.fn(() => builder);
          builder.is = vi.fn(() => builder);
          builder.maybeSingle = vi.fn(async () => ({ data: null, error: { message: "injected" } }));
          return builder;
        }
        const row =
          table === "items"
            ? { id: ITEM, board_id: BOARD, org_id: ORG, assigned_to: OWNER, deleted_at: null, title: "기존상호", deal_id: DEAL }
            : table === "deals"
              ? { company_id: mocks.dealCompanyId }
              : table === "companies"
                ? { biz_no: null, name: "연계상호" }
                : table === "deal_intake"
                  ? { biz_no: null, birthdate: null, business_item: null }
                  : null;
        const data = mocks.missingTables.includes(table) ? null : row;
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.is = vi.fn(() => builder);
        builder.maybeSingle = vi.fn(async () => ({ data, error: null }));
        return builder;
      },
    };
  }),
}));
vi.mock("@/lib/deal/members", () => ({ listOrgMemberOptions: vi.fn(async () => []) }));
vi.mock("@/lib/notices/official-file", () => ({
  BOARD_ITEM_FILES_BUCKET: "board-item-files",
  boardItemStoragePath: vi.fn(() => "p"),
  encodeNoticeFile: vi.fn(),
}));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: vi.fn(async () => ({
    service: {
      getBoardDetail: vi.fn(async () => ({
        board: {
          id: BOARD,
          source: boardSourceFixture,
          is_system: isSystemFixture,
          detail_layout_jsonb: entriesFixture,
        },
        columns: columnsFixture,
        groups: [{ id: GROUP, detail_layout_jsonb: null }],
      })),
      getItem: vi.fn(async () => ({
        id: ITEM,
        board_id: BOARD,
        group_id: GROUP,
        deal_id: itemDealFixture,
        values: {},
      })),
      // 실제 setCells 저장 의미의 최소 재현: 정의 밖 무시·읽기전용 거부·
      // 시스템 보드 거부·그 외 repo 기록. 형식 판정은 실제 validateCell.
      setCells: vi.fn(
        async (
          _ctx: unknown,
          boardId: string,
          _itemId: string,
          patch: Record<string, unknown>,
        ) => {
          void boardId;
          if (isSystemFixture) {
            throw new Error(
              "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다",
            );
          }
          const errors: { key: string; message: string }[] = [];
          const values: Record<string, unknown> = {};
          for (const [key, raw] of Object.entries(patch)) {
            const col = columnsFixture.find((c) => c.key === key);
            if (!col) continue; // 정의 밖 무시 — 구멍 재현의 핵심.
            if (col.is_readonly) {
              errors.push({ key, message: "자동 계산되는 칸이라 손으로 고칠 수 없습니다" });
              continue;
            }
            if (!isSourceEditable(col.source)) {
              errors.push({ key, message: "자동으로 채워지는 칸은 직접 바꿀 수 없습니다" });
              continue;
            }
            const checked = validateCell(col.type, raw, null);
            if (!checked.ok) {
              errors.push({ key, message: checked.error ?? "값을 해석할 수 없습니다" });
              continue;
            }
            values[key] = checked.value;
          }
          for (const [key, value] of Object.entries(values)) {
            mocks.setCellsWrites.push({ key, value });
            await mocks.setValues(key, value);
          }
          return { item: {}, errors, undo: null };
        },
      ),
    },
    repo: {
      getItem: vi.fn(async () => ({ id: ITEM, board_id: BOARD, group_id: GROUP })),
      setValues: mocks.setValues,
    },
  })),
}));
vi.mock("@/lib/new-lead/mutations", () => ({
  NewLeadMutationError: class extends Error {},
  updateCanonicalNewLead: mocks.updateLead,
  updateCanonicalNewLeadMeta: mocks.updateMeta,
  updateCanonicalNewLeadTitle: mocks.updateTitle,
  updateOcrPrecompanyMeta: mocks.ocrMeta,
  updateLinkedCompanyBizNo: mocks.companyBizNo,
  syncLinkedCompanyName: mocks.companyNameSync,
}));

import {
  loadOcrCurrentAction,
  saveOcrFieldAction,
} from "./ocr-actions";

const BASE = {
  boardId: BOARD,
  itemId: ITEM,
  dealId: DEAL as string | null,
};

function resetFixtures() {
  columnsFixture = [
    column("rep_name"),
    column("address_detail"),
    column("industry"),
    column("biz_reg_type"),
  ];
  entriesFixture = [
    { key: "rep_name", source: "column" as const },
    { key: "address_detail", source: "column" as const },
    { key: "industry", source: "column" as const },
    { key: "biz_reg_type", source: "column" as const },
    { key: "founded_month", source: "detail" as const },
  ];
  boardSourceFixture = NEW_LEAD_TAB_SOURCE;
  isSystemFixture = false;
  itemDealFixture = DEAL;
  mocks.dealCompanyId = null;
}

beforeEach(() => {
  resetFixtures();
  mocks.setValues.mockReset().mockResolvedValue(undefined);
  mocks.setCellsWrites.length = 0;
  mocks.queryErrorTable = null;
  mocks.missingTables = [];
  for (const fn of [
    mocks.updateLead,
    mocks.updateMeta,
    mocks.updateTitle,
    mocks.ocrMeta,
    mocks.companyBizNo,
    mocks.companyNameSync,
  ]) {
    fn.mockReset().mockResolvedValue({ replayed: false, skipped: false });
  }
});

describe("saveOcrFieldAction — 정상 4+ 필드 경로 보존", () => {
  it("대표자/주소/업종/개업연월이 각 경로로 저장된다", async () => {
    const base = "base-normal-1";
    const calls = [
      { ocrKey: "representative", fieldKey: "rep_name", source: "column", value: "홍길동" },
      { ocrKey: "businessAddress", fieldKey: "address_detail", source: "column", value: "서울 강남" },
      { ocrKey: "businessCategory", fieldKey: "industry", source: "column", value: "서비스업" },
      { ocrKey: "openedOn", fieldKey: "founded_month", source: "detail", value: "2024-03" },
    ] as const;
    for (const c of calls) {
      const result = await saveOcrFieldAction({
        ...BASE,
        ocrKey: c.ocrKey,
        fieldKey: c.fieldKey,
        source: c.source,
        value: c.value,
        requestId: `00000000-0000-4000-8000-00000000${calls.indexOf(c) + 101}`,
      });
      expect(result.ok).toBe(true);
    }
    expect(mocks.updateLead).toHaveBeenCalledTimes(2);
    expect(mocks.updateLead).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ patch: { representative_name: "홍길동" } }),
    );
    expect(mocks.updateMeta).toHaveBeenCalledTimes(1);
    expect(mocks.updateMeta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ patch: { address_detail: "서울 강남" } }),
    );
    // founded_month는 detail 경로 setValues(ctx, itemId, values)로 기록된다.
    expect(mocks.setValues).toHaveBeenCalledWith(expect.anything(), ITEM, {
      founded_month: "2024-03",
    });
    void base;
  });
});

describe("saveOcrFieldAction — 위조·불일치·읽기전용·형식오류·범위밖", () => {
  it("detail-only 키를 source=column으로 위조하면 쓰고 성공하지 않는다", async () => {
    const result = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "openedOn",
      fieldKey: "founded_month",
      source: "column", // 실제는 detail — 위조.
      value: "2024-03",
      requestId: "00000000-0000-4000-8000-000000000201",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("일치하지 않습니다");
    expect(mocks.setValues).not.toHaveBeenCalled();
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.updateMeta).not.toHaveBeenCalled();
  });

  it("정본 대상을 source=column으로 위장해도 거부된다", async () => {
    const result = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "birthdate",
      fieldKey: "birthdate",
      source: "column", // 셀 없는 정본 대상은 canonical이어야 한다.
      value: "1990-01-15",
      requestId: "00000000-0000-4000-8000-000000000207",
    });
    expect(result.ok).toBe(false);
    expect(mocks.ocrMeta).not.toHaveBeenCalled();
  });

  it("deal 불일치면 어떤 쓰기도 하지 않는다", async () => {
    const result = await saveOcrFieldAction({
      ...BASE,
      dealId: "00000000-0000-4000-8000-000000000099",
      ocrKey: "representative",
      fieldKey: "rep_name",
      source: "column",
      value: "홍길동",
      requestId: "00000000-0000-4000-8000-000000000202",
    });
    expect(result.ok).toBe(false);
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.setValues).not.toHaveBeenCalled();
  });

  it("읽기전용 칸은 정본 RPC 이전에 거부된다", async () => {
    columnsFixture = [column("rep_name", { is_readonly: true })];
    const result = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "representative",
      fieldKey: "rep_name",
      source: "column",
      value: "홍길동",
      requestId: "00000000-0000-4000-8000-000000000203",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("자동 계산");
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });

  it("형식 오류 값은 정본 RPC 이전에 거부된다", async () => {
    columnsFixture = [column("rep_name", { type: "email" })];
    const result = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "representative",
      fieldKey: "rep_name",
      source: "column",
      value: "홍길동",
      requestId: "00000000-0000-4000-8000-000000000204",
    });
    expect(result.ok).toBe(false);
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });

  it("배치 밖 키는 거부된다", async () => {
    const result = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "representative",
      fieldKey: "owner",
      source: "column",
      value: "홍길동",
      requestId: "00000000-0000-4000-8000-000000000205",
    });
    expect(result.ok).toBe(false);
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.setValues).not.toHaveBeenCalled();
  });

  // 시스템 보드는 별도 분기로 막지 않는다(지적 요구). 컬럼 경로는 위임先
  // setCells의 실제 정책(requireEditableBoard)이 그대로 거부하고, 정본
  // 경로는 SQL 투영 판정이 소유한다. 새 blanket 규칙을 두지 않으므로
  // 여기서 is_system 전용 케이스를 두지 않는다.
});

describe("saveOcrFieldAction — 필수 4종(title·생년월일·종목·사업자번호)", () => {
  it("상호는 title RPC로, 연계 있으면 확정+CAS 회사 정정도 별도 ID로", async () => {
    mocks.dealCompanyId = COMPANY;
    const result = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "companyName",
      fieldKey: "title",
      source: "canonical",
      value: "(주)가상상회",
      requestId: "00000000-0000-4000-8000-000000000301",
      confirmed: true,
      expected: "연계상호",
    });
    expect(result.ok).toBe(true);
    expect(mocks.updateTitle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "(주)가상상회" }),
    );
    expect(mocks.companyNameSync).toHaveBeenCalledTimes(1);
    expect(mocks.companyNameSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "(주)가상상회", expected: "연계상호", confirmed: true }),
    );
    const titleId = mocks.updateTitle.mock.calls[0][1].requestId;
    const syncId = mocks.companyNameSync.mock.calls[0][1].requestId;
    expect(titleId).not.toBe(syncId);
  });

  it("연계 상호는 확정 없으면 쓰지 않고, CAS 충돌이면 title도 쓰지 않는다", async () => {
    mocks.dealCompanyId = COMPANY;
    // 확정 없음 — 회사도 title도 쓰지 않는다.
    const unconfirmed = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "companyName",
      fieldKey: "title",
      source: "canonical",
      value: "(주)가상상회",
      requestId: "00000000-0000-4000-8000-000000000309",
      confirmed: false,
      expected: "연계상호",
    });
    expect(unconfirmed.ok).toBe(false);
    expect(mocks.companyNameSync).not.toHaveBeenCalled();
    expect(mocks.updateTitle).not.toHaveBeenCalled();
    // 비교 기준 없음 — 쓰지 않는다.
    const noExpected = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "companyName",
      fieldKey: "title",
      source: "canonical",
      value: "(주)가상상회",
      requestId: "00000000-0000-4000-8000-000000000310",
      confirmed: true,
    });
    expect(noExpected.ok).toBe(false);
    expect(mocks.companyNameSync).not.toHaveBeenCalled();
    expect(mocks.updateTitle).not.toHaveBeenCalled();
    // CAS 충돌(guard-first) — title도 쓰지 않는다.
    const { NewLeadMutationError } = await import("@/lib/new-lead/mutations");
    mocks.companyNameSync.mockRejectedValueOnce(new NewLeadMutationError("conflict", "22023"));
    const conflicted = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "companyName",
      fieldKey: "title",
      source: "canonical",
      value: "(주)가상상회",
      requestId: "00000000-0000-4000-8000-000000000311",
      confirmed: true,
      expected: "낡은관찰값",
    });
    expect(conflicted.ok).toBe(false);
    expect(mocks.companyNameSync).toHaveBeenCalledTimes(1);
    expect(mocks.updateTitle).not.toHaveBeenCalled();
  });

  it("생년월일은 날짜만 — 주민번호 형태는 거부, 정상 날짜는 meta로", async () => {
    const bad = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "birthdate",
      fieldKey: "birthdate",
      source: "canonical",
      value: "900101-1234567",
      requestId: "00000000-0000-4000-8000-000000000302",
    });
    expect(bad.ok).toBe(false);
    expect(mocks.ocrMeta).not.toHaveBeenCalled();
    const good = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "birthdate",
      fieldKey: "birthdate",
      source: "canonical",
      value: "1990-01-15",
      requestId: "00000000-0000-4000-8000-000000000303",
    });
    expect(good.ok).toBe(true);
    expect(mocks.ocrMeta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ patch: { birthdate: "1990-01-15" } }),
    );
  });

  it("종목은 업태와 분리 — industry 패치가 아니라 business_item으로", async () => {
    const result = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "businessItem",
      fieldKey: "business_item",
      source: "canonical",
      value: "경영컨설팅",
      requestId: "00000000-0000-4000-8000-000000000304",
    });
    expect(result.ok).toBe(true);
    expect(mocks.ocrMeta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ patch: { business_item: "경영컨설팅" } }),
    );
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });

  it("사업자번호 미연계+확정+합성 유효번호는 intake meta로", async () => {
    mocks.dealCompanyId = null;
    const result = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "bizNo",
      fieldKey: "biz_no",
      source: "canonical",
      value: VALID_BIZ_NO,
      requestId: "00000000-0000-4000-8000-000000000305",
      confirmed: true,
    });
    expect(result.ok).toBe(true);
    expect(mocks.ocrMeta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ patch: { biz_no: "1234567891" } }),
    );
    expect(mocks.companyBizNo).not.toHaveBeenCalled();
  });

  it("사업자번호 연계+확정은 회사 RPC로, 확정 없으면 거부", async () => {
    mocks.dealCompanyId = COMPANY;
    const denied = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "bizNo",
      fieldKey: "biz_no",
      source: "canonical",
      value: VALID_BIZ_NO,
      requestId: "00000000-0000-4000-8000-000000000306",
      confirmed: false,
    });
    expect(denied.ok).toBe(false);
    expect(mocks.companyBizNo).not.toHaveBeenCalled();
    const allowed = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "bizNo",
      fieldKey: "biz_no",
      source: "canonical",
      value: VALID_BIZ_NO,
      requestId: "00000000-0000-4000-8000-000000000307",
      confirmed: true,
    });
    expect(allowed.ok).toBe(true);
    expect(mocks.companyBizNo).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bizNo: "1234567891", confirmed: true }),
    );
  });

  it("체크섬 실패 번호는 어디에도 쓰지 않는다", async () => {
    const result = await saveOcrFieldAction({
      ...BASE,
      ocrKey: "bizNo",
      fieldKey: "biz_no",
      source: "canonical",
      value: "000-00-00000",
      requestId: "00000000-0000-4000-8000-000000000308",
      confirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(mocks.ocrMeta).not.toHaveBeenCalled();
    expect(mocks.companyBizNo).not.toHaveBeenCalled();
  });
});

describe("loadOcrCurrentAction — typed 읽기", () => {
  it("행 제목·intake·연계 정보를 typed로 돌린다", async () => {
    mocks.dealCompanyId = COMPANY;
    const result = await loadOcrCurrentAction({ boardId: BOARD, itemId: ITEM });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.current.title).toBe("기존상호");
      expect(result.current.linkedCompany).toBe(true);
      expect(result.current.linkedCompanyName).toBe("연계상호");
      expect(typeof result.current.birthdate).toBe("string");
    }
  });

  it("조회 오류는 각각 ok:false로 닫힌다 — 빈 current+ok:true 금지", async () => {
    mocks.dealCompanyId = COMPANY;
    mocks.queryErrorTable = "deals";
    const dealFailed = await loadOcrCurrentAction({ boardId: BOARD, itemId: ITEM });
    expect(dealFailed.ok).toBe(false);
    mocks.queryErrorTable = "companies";
    const companyFailed = await loadOcrCurrentAction({ boardId: BOARD, itemId: ITEM });
    expect(companyFailed.ok).toBe(false);
    if (!companyFailed.ok) expect(companyFailed.message).toMatch(/연계 회사 정보/);
    mocks.queryErrorTable = "deal_intake";
    const intakeFailed = await loadOcrCurrentAction({ boardId: BOARD, itemId: ITEM });
    expect(intakeFailed.ok).toBe(false);
    if (!intakeFailed.ok) expect(intakeFailed.message).toMatch(/비교 기준/);
    mocks.queryErrorTable = "items";
    const itemFailed = await loadOcrCurrentAction({ boardId: BOARD, itemId: ITEM });
    expect(itemFailed.ok).toBe(false);
  });

  it("연계로 잡힌 회사가 없으면 명시 오류 — 없는 회사명과 비교하지 않는다", async () => {
    mocks.dealCompanyId = COMPANY;
    mocks.missingTables = ["companies"];
    const result = await loadOcrCurrentAction({ boardId: BOARD, itemId: ITEM });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/연계된 회사를 찾을 수 없습니다/);
  });

  it("intake 행 없음은 정상(보관 전) — 빈 값 ok:true로 구분된다", async () => {
    mocks.dealCompanyId = null;
    mocks.missingTables = ["deal_intake"];
    const result = await loadOcrCurrentAction({ boardId: BOARD, itemId: ITEM });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.current.birthdate).toBe("");
      expect(result.current.businessItem).toBe("");
      expect(result.current.linkedCompany).toBe(false);
    }
  });
  it("reports company-name success separately when title response is lost and reuses IDs", async () => {
    mocks.dealCompanyId = COMPANY;
    mocks.companyNameSync.mockResolvedValue({ skipped: false, replayed: false });
    mocks.updateTitle.mockRejectedValueOnce(new Error("response lost"));
    const input = { ...BASE, ocrKey: "companyName" as const, fieldKey: "title", source: "canonical" as const,
      value: "정정상호", confirmed: true, expected: "연계상호", requestId: "00000000-0000-4000-8000-000000000199" };
    const first = await saveOcrFieldAction(input);
    expect(first.ok).toBe(false);
    expect(first.message).toContain("연계 회사명은 반영됐습니다");
    expect(first.message).toContain("행 제목의 저장 결과는 확인하지 못했습니다");
    expect(first.message).not.toContain("response lost");
    mocks.companyNameSync.mockResolvedValueOnce({ skipped: false, replayed: true });
    mocks.updateTitle.mockResolvedValueOnce({ replayed: true });
    expect((await saveOcrFieldAction(input)).ok).toBe(true);
    expect(mocks.companyNameSync.mock.calls[1][1].requestId).toBe(mocks.companyNameSync.mock.calls[0][1].requestId);
    expect(mocks.updateTitle.mock.calls[1][1].requestId).toBe(mocks.updateTitle.mock.calls[0][1].requestId);
  });

});
