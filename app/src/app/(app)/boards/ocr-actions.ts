"use server";

/**
 * OCR 필드 저장의 별도 서버 액션.
 *
 * ItemDetailOcr의 제안은 이 액션으로만 저장한다. 클라이언트가 넘긴
 * source/deal 플래그는 신뢰하지 않고 서버에서 실제 정의를 재확인한다:
 * - tenant·row: 세션 org + items 행 존재 + 담당 범위 (context 역할).
 * - work: `work.item_upsert` 권한 (허용/거부 양쪽 그대로 전달).
 * - board source: `getBoardDetail`의 실제 `board.source`.
 * - item/deal: 행의 실제 `deal_id`와 입력 dealId 일치 (다르면 거부).
 * - column/detail: 실제 컬럼 정의(키·타입·source·is_readonly·options)와
 *   실제 상세 배치. 클라이언트가 우기는 source와 실제가 다르면 거부한다.
 *   (detail-only 키를 source=column으로 보내면 setCells가 조용히 무시하고
 *   성공을 돌려주므로, 여기서 먼저 명시 거부한다 — 성공 no-op 금지.)
 * - 값 검증은 정본 RPC **이전**에 한다: 읽기전용·자동계산 칸은 쓰지 않고,
 *   `validateCell`을 통과하지 못한 값도 쓰지 않는다.
 * - 시스템 보드는 별도 분기로 막지 않는다. 일반 경로는 기존
 *   `saveItemDetailFieldAction`에 위임해 실제 정책(requireEditableBoard)
 *   그대로를 따르고, 정본 경로는 SQL의 투영 판정
 *   (b.source='core.default-tab/new-lead')이 소유한다.
 *
 * 판정 자체는 순수 함수 `routeOcrBoardField`가 맡는다 (단위 테스트).
 * - 정본 신규리드 보드 + deal 일치 + 정본 키 → 정본 RPC
 *   (`updateCanonicalNewLead` / `updateCanonicalNewLeadMeta` /
 *   `updateCanonicalNewLeadTitle` / 154 초안 intake meta·연계 회사 RPC)에
 *   필드별 안정 requestId를 그대로 넘겨 재시도 멱등(replay)을 보장한다.
 * - 그 외 배치에 있는 일반 필드 → 기존 `saveItemDetailFieldAction`에 위임.
 * - 배치에 없는 키·OCR 저장 대상이 아닌 키 → 명시 거부 (짜 저장 금지).
 *
 * 원자 전체 저장이 아니다. 호출자는 한 필드씩 보내며, 실패해도 나머지는
 * 계속한다 — 부분 실패 계약(성공 유지·실패만 재시도)을 지킨다.
 *
 * OCR 원문·문서 전체는 이 액션에 오지 않는다. 오는 것은 사용자가 체크한
 * 필드값뿐이며, 저장은 정상 감사(audit·영수증)로만 남는다.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createRequestBoards } from "@/lib/boards/server";
import {
  resolveBoardDetailLayout,
  resolveDetailLayout,
} from "@/lib/boards/detail-layout";
import { validateCell } from "@/lib/boards/cells";
import { isFieldSource, isSourceEditable } from "@/lib/field/source";
import { loadPermGuard } from "@/lib/perm/guard";
import { deriveOcrFieldRequestId } from "@/lib/document-ocr/apply-adapter";
import { isValidBizNo, normalizeBizNo } from "@/lib/document-ocr/bizno";
import { routeOcrBoardField } from "@/lib/document-ocr/canonical-route";
import type { OcrFieldKey } from "@/lib/document-ocr/types";
import {
  NewLeadMutationError,
  syncLinkedCompanyName,
  updateCanonicalNewLead,
  updateCanonicalNewLeadMeta,
  updateCanonicalNewLeadTitle,
  updateLinkedCompanyBizNo,
  updateOcrPrecompanyMeta,
} from "@/lib/new-lead/mutations";
import { saveItemDetailFieldAction } from "./item-detail-actions";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BIRTHDATE_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

function validBirthdate(value: string): boolean {
  const v = value.trim();
  if (!BIRTHDATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export type SaveOcrFieldState = Readonly<{ ok: boolean; message: string }>;

export async function saveOcrFieldAction(input: {
  boardId: string;
  itemId: string;
  /** linked 신규리드 행의 deal. 없으면 정본 RPC로 보내지 않는다. */
  dealId?: string | null;
  /** 어느 OCR 필드에서 왔는지 (정본 대상 라우팅·값 검증용). */
  ocrKey: OcrFieldKey;
  fieldKey: string;
  /**
   * 저장 위치 주장. 셀 대상은 실제 정의(column/detail)와 일치해야 하고,
   * 셀 없는 정본 대상(title·birthdate·business_item·biz_no)은 "canonical"
   * 이어야 한다. 어긋나면 쓰기 전에 거부한다.
   */
  source: "column" | "detail" | "canonical";
  value: string;
  /** 필드별 안정 멱등 키 — 어댑터가 base 의도에서 파생해 전달. */
  requestId?: string;
  /** 사업자등록번호 명시 확정 (체크섬 통과 확인에 사용자가 체크). */
  confirmed?: boolean;
  /**
   * 연계 회사명 CAS 이전값 — 비교 화면에서 본 회사명이다. 연계 title 저장에만
   * 쓰이며, null이면 비교 기준 없이 저장하지 않는다 (서버 RPC도 22023).
   */
  expected?: string | null;
}): Promise<SaveOcrFieldState> {
  try {
    if (!UUID.test(input.boardId) || !UUID.test(input.itemId)) {
      return { ok: false, message: "잘못된 상세 요청입니다." };
    }
    const ctx = await getSession();
    const scoped = await createClient({ noStore: true });
    const { data: item, error } = await scoped
      .from("items")
      .select("id,board_id,org_id,assigned_to,deleted_at")
      .eq("id", input.itemId)
      .eq("board_id", input.boardId)
      .eq("org_id", ctx.org.id)
      .is("deleted_at", null)
      .is("archived_at", null)
      .maybeSingle();
    if (error || !item) {
      return { ok: false, message: "이 회사 정보를 열 권한이 없거나 항목을 찾을 수 없습니다." };
    }
    if (
      ctx.role !== "owner" &&
      ctx.role !== "admin" &&
      ctx.scope !== "all" &&
      item.assigned_to !== ctx.user.id
    ) {
      return { ok: false, message: "이 회사 정보를 열 권한이 없거나 항목을 찾을 수 없습니다." };
    }
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") {
      return {
        ok: false,
        message:
          permission.reason === "permission"
            ? "이 정보를 수정할 권한이 없습니다."
            : "권한을 확인하지 못했습니다.",
      };
    }

    const graph = await createRequestBoards();
    const [board, fullItem] = await Promise.all([
      graph.service.getBoardDetail(ctx, input.boardId),
      graph.service.getItem(ctx, input.boardId, input.itemId),
    ]);
    if (!fullItem || fullItem.board_id !== input.boardId) {
      return { ok: false, message: "아이템을 찾을 수 없습니다." };
    }

    // deal 재확인: 입력 dealId가 행의 실제 deal_id와 다르면 거부한다.
    const actualDealId = fullItem.deal_id;
    if (input.dealId && input.dealId !== actualDealId) {
      return { ok: false, message: "연결된 신규리드와 행이 일치하지 않습니다. 새로고침 후 다시 시도하세요." };
    }
    const dealId = input.dealId && input.dealId === actualDealId ? input.dealId : null;

    const group = fullItem.group_id
      ? board.groups.find((candidate) => candidate.id === fullItem.group_id)
      : undefined;
    const boardLayout = resolveBoardDetailLayout(
      board.board.source,
      board.board.detail_layout_jsonb,
      board.columns,
    );
    const entries = resolveDetailLayout(boardLayout, group?.detail_layout_jsonb).entries;
    const columnKeys = board.columns.map((column) => column.key);
    const detailKeys = entries
      .filter((entry) => entry.source === "detail")
      .map((entry) => entry.key);

    // 클라이언트 source 주장 검증 — 실제 정의와 다르면 쓰기 전에 거부한다.
    // 셀 없는 정본 대상은 source "canonical"이어야 하고, 셀 대상은 실제
    // 정의(column/detail)와 일치해야 한다.
    const SOURCE_MISMATCH = {
      ok: false,
      message:
        "요청한 저장 위치와 실제 배치가 일치하지 않습니다. 새로고침 후 다시 시도하세요. 저장하지 않았습니다.",
    } as const;
    const isCellTarget =
      columnKeys.includes(input.fieldKey) || detailKeys.includes(input.fieldKey);
    if (isCellTarget) {
      const actualSource: "column" | "detail" = columnKeys.includes(input.fieldKey)
        ? "column"
        : "detail";
      if (input.source !== actualSource) return SOURCE_MISMATCH;
    } else if (input.source !== "canonical") {
      return SOURCE_MISMATCH;
    }

    // 연계 회사 유무는 deals에서 재확인한다 (biz_no·title 분기용).
    let linkedCompany = false;
    if (input.fieldKey === "biz_no" || input.fieldKey === "title") {
      if (!dealId) {
        return { ok: false, message: "연결된 신규리드가 없어 정본에 저장하지 않았습니다. 새로고침 후 다시 시도하세요." };
      }
      const { data: dealRow, error: dealError } = await scoped
        .from("deals")
        .select("company_id")
        .eq("id", dealId)
        .eq("org_id", ctx.org.id)
        .maybeSingle();
      if (dealError) {
        return { ok: false, message: "연계 회사 정보를 확인하지 못했습니다. 저장하지 않았습니다." };
      }
      linkedCompany =
        !!dealRow && typeof (dealRow as { company_id?: unknown }).company_id === "string";
    }

    const route = routeOcrBoardField({
      boardSource: board.board.source ?? "",
      ocrKey: input.ocrKey,
      fieldKey: input.fieldKey,
      dealId,
      linkedCompany,
      columnKeys,
      detailKeys,
    });
    if (route.route === "reject") {
      return { ok: false, message: route.reason };
    }

    // 값 검증은 쓰기 이전에 끝낸다. 여기서 떨어지면 RPC·setCells를 호출하지
    // 않으므로(first write 없음) 아래 테스트가 "호출 없음"으로 증명한다.
    const cellCheck = checkCellWritable(board.columns, input.fieldKey, input.value);
    if (!cellCheck.ok) return { ok: false, message: cellCheck.message };

    const requestId = input.requestId?.trim() || crypto.randomUUID();
    const client = await createClient();
    if (route.route === "canonical-update") {
      await updateCanonicalNewLead(client, {
        orgId: ctx.org.id,
        dealId: dealId as string,
        requestId,
        patch: { [route.patchKey]: input.value || null },
        valueSource: "manual",
      });
      revalidatePath(`/boards/${input.boardId}`);
      revalidatePath("/newcust");
      return { ok: true, message: "✓ 자동 저장됨" };
    }
    if (route.route === "canonical-meta") {
      await updateCanonicalNewLeadMeta(client, {
        orgId: ctx.org.id,
        dealId: dealId as string,
        requestId,
        patch: { address_detail: input.value || null },
      });
      revalidatePath(`/boards/${input.boardId}`);
      revalidatePath("/newcust");
      return { ok: true, message: "✓ 자동 저장됨" };
    }
    if (route.route === "canonical-title") {
      const title = input.value.trim();
      if (!title) {
        return { ok: false, message: "상호가 비어 있어 저장하지 않았습니다. 기존 제목을 유지합니다." };
      }
      if (title.length > 120) {
        return { ok: false, message: "상호가 너무 깁니다(120자 이내). 저장하지 않았습니다." };
      }
      // 연계 회사가 있으면 회사 정정을 먼저 수행한다 (guard-first — CAS 충돌이면
      // title도 쓰지 않고 재확인을 요청한다). 사용자 확정 + 비교 기준이 있어야
      // 틀린 원본을 고친다. 회사 동기화는 별도 영수증(별도 파생 ID)이라 title
      // 영수증과 겹치지 않는다.
      let companyMessage = "";
      if (linkedCompany) {
        if (input.confirmed !== true) {
          return {
            ok: false,
            message:
              "연계 회사명은 비교 화면에서 회사명 확정을 체크해야 저장됩니다. 체크하지 않아 저장하지 않았습니다.",
          };
        }
        if (input.expected === null || input.expected === undefined) {
          return {
            ok: false,
            message: "연계 회사명의 비교 기준을 확인하지 못했습니다. 비교 기준을 다시 읽은 뒤 시도하세요. 저장하지 않았습니다.",
          };
        }
        const syncId = deriveOcrFieldRequestId(requestId, input.ocrKey, "companies.name", title);
        // 충돌·거부는 바깥 catch가 NewLeadMutationError 메시지로 전달한다.
        // 이 지점에서는 쓴 것이 없으므로(guard-first) 재확인이 안전하다.
        const synced = await syncLinkedCompanyName(client, {
          orgId: ctx.org.id,
          dealId: dealId as string,
          requestId: syncId,
          title,
          expected: input.expected,
          confirmed: true,
        });
        companyMessage = synced.skipped ? " (연계 회사명은 이미 같은 값입니다)" : " (연계 회사명도 함께 정정했습니다)";
      }
      try {
        await updateCanonicalNewLeadTitle(client, {
          orgId: ctx.org.id,
          dealId: dealId as string,
          requestId,
          title,
          valueSource: "manual",
        });
      } catch (error) {
        if (!linkedCompany) throw error;
        revalidatePath(`/boards/${input.boardId}`);
        revalidatePath("/newcust");
        return {
          ok: false,
          message: "연계 회사명은 반영됐습니다. 행 제목의 저장 결과는 확인하지 못했습니다. 입력은 유지되며 같은 값으로 다시 적용하면 남은 결과를 확인할 수 있습니다.",
        };
      }
      revalidatePath(`/boards/${input.boardId}`);
      revalidatePath("/newcust");
      return { ok: true, message: `✓ 자동 저장됨${companyMessage}` };
    }
    if (route.route === "ocr-meta") {
      const checked = checkOcrMetaValue(route.metaKey, input.value, input.confirmed === true);
      if (!checked.ok) return { ok: false, message: checked.message };
      await updateOcrPrecompanyMeta(client, {
        orgId: ctx.org.id,
        dealId: dealId as string,
        requestId,
        patch: { [route.metaKey]: checked.stored },
        valueSource: "manual",
      });
      revalidatePath(`/boards/${input.boardId}`);
      revalidatePath("/newcust");
      return { ok: true, message: "✓ 자동 저장됨" };
    }
    if (route.route === "company-bizno") {
      const digits = normalizeBizNo(input.value);
      if (!isValidBizNo(input.value)) {
        return { ok: false, message: "사업자등록번호 체크섬이 맞지 않습니다. 숫자를 직접 확인해 주세요. 저장하지 않았습니다." };
      }
      if (input.confirmed !== true) {
        return { ok: false, message: "사업자등록번호는 체크섬 통과와 사용자 확정이 함께 있어야 저장됩니다." };
      }
      await updateLinkedCompanyBizNo(client, {
        orgId: ctx.org.id,
        dealId: dealId as string,
        requestId,
        bizNo: digits,
        confirmed: true,
      });
      revalidatePath(`/boards/${input.boardId}`);
      revalidatePath("/newcust");
      return { ok: true, message: "✓ 자동 저장됨" };
    }
    // generic — 실제 정책은 saveItemDetailFieldAction → setCells가 소유한다
    // (시스템 보드 거부·읽기전용·validateCell). 위 cellCheck는 그 앞의
    // 조기 거부라 실제 쓰기를 바꾸지 않는다.
    // generic에는 셀 대상만 오므로 source는 column|detail로 좁혀져 있다
    // (canonical 주장은 위 SOURCE_MISMATCH에서 거부됨).
    if (input.source === "canonical") {
      return {
        ok: false,
        message:
          "요청한 저장 위치와 실제 배치가 일치하지 않습니다. 새로고침 후 다시 시도하세요. 저장하지 않았습니다.",
      };
    }
    return saveItemDetailFieldAction({
      boardId: input.boardId,
      itemId: input.itemId,
      fieldKey: input.fieldKey,
      source: input.source,
      value: input.value,
      requestId,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof NewLeadMutationError
          ? error.message
          : error instanceof Error
            ? error.message
            : "저장하지 못했습니다. 입력은 유지됩니다.",
    };
  }
}

/**
 * 실제 컬럼 정의 기준의 쓰기 가능 판정 (정본 RPC 이전 조기 거부용).
 * - 정의가 없으면(detail 전용 등) 통과 — 실제 쓰기 경로가 최종 판정한다.
 * - 읽기전용·자동계산(source) 칸은 값과 무관하게 거부한다.
 * - 형식 오류는 validateCell 메시지로 거부한다.
 */
function checkCellWritable(
  columns: readonly {
    key: string;
    type: Parameters<typeof validateCell>[0];
    source: string;
    is_readonly?: boolean;
    options_jsonb: { options: Parameters<typeof validateCell>[2] } | null;
  }[],
  fieldKey: string,
  value: string,
): { ok: true } | { ok: false; message: string } {
  const column = columns.find((candidate) => candidate.key === fieldKey);
  if (!column) return { ok: true };
  if (column.is_readonly) {
    return { ok: false, message: "자동 계산되는 칸이라 손으로 고칠 수 없습니다. 저장하지 않았습니다." };
  }
  // 알 수 없는 source는 fail-closed — 편집 가능으로 추정하지 않는다.
  if (!isFieldSource(column.source) || !isSourceEditable(column.source)) {
    return { ok: false, message: "자동으로 채워지는 칸은 직접 바꿀 수 없습니다. 저장하지 않았습니다." };
  }
  const options = column.options_jsonb?.options ?? null;
  const checked = validateCell(column.type, value, options);
  if (!checked.ok) {
    return { ok: false, message: `${checked.error ?? "값을 해석할 수 없습니다"}. 저장하지 않았습니다.` };
  }
  return { ok: true };
}

/** 셀 없는 정본 대상(intake meta)의 값 검증 — 쓰기 이전. */
function checkOcrMetaValue(
  metaKey: "birthdate" | "business_item" | "biz_no",
  value: string,
  confirmed: boolean,
): { ok: true; stored: string | null } | { ok: false; message: string } {
  if (metaKey === "birthdate") {
    // 날짜만 — 주민번호·시각 정보는 받지 않는다.
    if (!validBirthdate(value)) {
      return { ok: false, message: "생년월일은 YYYY-MM-DD 실재 날짜만 저장합니다. 저장하지 않았습니다." };
    }
    return { ok: true, stored: value.trim() };
  }
  if (metaKey === "business_item") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 60) {
      return { ok: false, message: "종목은 1~60자로 저장합니다. 저장하지 않았습니다." };
    }
    return { ok: true, stored: trimmed };
  }
  const digits = normalizeBizNo(value);
  if (!isValidBizNo(value)) {
    return { ok: false, message: "사업자등록번호 체크섬이 맞지 않습니다. 숫자를 직접 확인해 주세요. 저장하지 않았습니다." };
  }
  if (!confirmed) {
    return { ok: false, message: "사업자등록번호는 체크섬 통과와 사용자 확정이 함께 있어야 저장됩니다." };
  }
  return { ok: true, stored: digits };
}

export type OcrExtraCurrent = Readonly<{
  /** 행 제목 (companyName 비교 기준). */
  title: string;
  /** 연계 회사 사업자번호(있으면) — 없으면 intake 보관분. */
  bizNo: string;
  /** intake 보관 생년월일 (YYYY-MM-DD). */
  birthdate: string;
  /** intake 보관 종목. */
  businessItem: string;
  /** deals.company_id 유무. */
  linkedCompany: boolean;
  /** 연계 회사명 (회사명 정정 CAS 이전값, 미연계면 ""). */
  linkedCompanyName: string;
}>;

/**
 * OCR diff의 비교 기준 읽기 (typed, EAV 우회 없음).
 * title은 items 행, biz_no는 연계 회사 원본(있으면) 아니면 intake 보관분,
 * birthdate/business_item은 intake 보관분에서 읽는다. RLS는 호출자 그대로.
 */
export async function loadOcrCurrentAction(input: {
  boardId: string;
  itemId: string;
}): Promise<{ ok: true; current: OcrExtraCurrent } | { ok: false; message: string }> {
  try {
    if (!UUID.test(input.boardId) || !UUID.test(input.itemId)) {
      return { ok: false, message: "잘못된 상세 요청입니다." };
    }
    const ctx = await getSession();
    const scoped = await createClient({ noStore: true });
    const { data: item, error } = await scoped
      .from("items")
      .select("id,board_id,org_id,title,assigned_to,deleted_at,deal_id")
      .eq("id", input.itemId)
      .eq("board_id", input.boardId)
      .eq("org_id", ctx.org.id)
      .is("deleted_at", null)
      .is("archived_at", null)
      .maybeSingle();
    if (error || !item) {
      return { ok: false, message: "이 회사 정보를 열 권한이 없거나 항목을 찾을 수 없습니다." };
    }
    const row = item as {
      title?: unknown;
      assigned_to?: unknown;
      deal_id?: unknown;
    };
    if (
      ctx.role !== "owner" &&
      ctx.role !== "admin" &&
      ctx.scope !== "all" &&
      row.assigned_to !== ctx.user.id
    ) {
      return { ok: false, message: "이 회사 정보를 열 권한이 없거나 항목을 찾을 수 없습니다." };
    }
    const title = typeof row.title === "string" ? row.title : "";
    const dealId = typeof row.deal_id === "string" ? row.deal_id : null;
    let linkedCompany = false;
    let linkedBizNo = "";
    let linkedCompanyName = "";
    let intakeBizNo = "";
    let birthdate = "";
    let businessItem = "";
    if (dealId) {
      // 각 조회의 오류는 버리지 않는다 — 조용히 빈 값으로 두면 비교 화면이
      // 낡은 기준을 보여주고 그 위에서 저장이 된다. 오류면 ok:false로 닫는다.
      const { data: deal, error: dealError } = await scoped
        .from("deals")
        .select("company_id")
        .eq("id", dealId)
        .eq("org_id", ctx.org.id)
        .maybeSingle();
      if (dealError) {
        return { ok: false, message: "연결된 신규리드 정보를 확인하지 못했습니다. 다시 시도하세요. 저장하지 않았습니다." };
      }
      if (!deal) {
        return { ok: false, message: "연결된 신규리드를 찾을 수 없습니다. 새로고침 후 다시 시도하세요. 저장하지 않았습니다." };
      }
      const companyId = (deal as { company_id?: unknown } | null)?.company_id;
      if (typeof companyId === "string" && companyId) {
        linkedCompany = true;
        const { data: company, error: companyError } = await scoped
          .from("companies")
          .select("biz_no,name")
          .eq("id", companyId)
          .eq("org_id", ctx.org.id)
          .maybeSingle();
        if (companyError) {
          return { ok: false, message: "연계 회사 정보를 확인하지 못했습니다. 다시 시도하세요. 저장하지 않았습니다." };
        }
        // 연계로 잡혀 있는데 회사가 없다 — 없는 회사명과 비교하면 안 된다.
        if (!company) {
          return { ok: false, message: "연계된 회사를 찾을 수 없습니다. 다시 연결한 뒤 시도하세요. 저장하지 않았습니다." };
        }
        const bizNo = (company as { biz_no?: unknown } | null)?.biz_no;
        if (typeof bizNo === "string" && bizNo) linkedBizNo = normalizeBizNo(bizNo);
        const companyName = (company as { name?: unknown } | null)?.name;
        if (typeof companyName === "string") linkedCompanyName = companyName;
      }
      const { data: intake, error: intakeError } = await scoped
        .from("deal_intake")
        .select("biz_no,birthdate,business_item")
        .eq("deal_id", dealId)
        .eq("org_id", ctx.org.id)
        .maybeSingle();
      if (intakeError) {
        return { ok: false, message: "보관된 비교 기준을 불러오지 못했습니다. 다시 시도하세요. 저장하지 않았습니다." };
      }
      // intake 행 없음은 정상(보관 전) — 빈 값으로 두고 저장을 막지 않는다.
      // 오류와 구분된다: 오류는 위에서 이미 ok:false로 닫혔다.
      const intakeRow = intake as
        | { biz_no?: unknown; birthdate?: unknown; business_item?: unknown }
        | null;
      if (intakeRow) {
        if (typeof intakeRow.biz_no === "string") intakeBizNo = normalizeBizNo(intakeRow.biz_no);
        if (typeof intakeRow.birthdate === "string") birthdate = intakeRow.birthdate;
        if (typeof intakeRow.business_item === "string") businessItem = intakeRow.business_item;
      }
    }
    return {
      ok: true,
      current: {
        title,
        bizNo: linkedBizNo || intakeBizNo,
        birthdate,
        businessItem,
        linkedCompany,
        linkedCompanyName,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "비교 기준을 불러오지 못했습니다.",
    };
  }
}
