"use server";

/**
 * 일괄 적용 서버 액션 — agenda06 보드 반복 조작 줄이기 (삭제 없음).
 *
 * 기존 단일 쓰기 경로를 그대로 재사용한다:
 *  - 셀 값: `BoardsService.setCells` (읽기전용·출처·무결성·선택지 검증 + 이동규칙 동일)
 *  - 담당자: deal 연결 행은 `reassign_deal_with_lineage` RPC 경유
 *    (AssignmentLineageService.reassign — deals/items/owner EAV/lineage version/history 보존),
 *    비연결 행은 `BoardsService.updateItem({ assigned_to })` + 조직 멤버 검증
 *    (단일 셀 흐름과 동일 조건, board 소속 사전 확인 + scope 가시성 강제)
 *  - 그룹 이동: `BoardsService.moveRowAtomic` (migration139 RPC-only, ordering/version/permission/group/status)
 *
 * 안전 규칙:
 *  - 권한은 호출당 1회 `work.item_upsert` 로 검사. 실패하면 건별 실패로 돌려준다 (던지지 않음).
 *  - 전이 강제 값은 순수 게이트 `bulkBlockReason` 이 막는다 — contact/seal 파이프라인을
 *    호출하지 않으므로 직인·계약 게이트를 우회할 자리가 없다.
 *  - 휴지통은 별도 액션을 사용한다. 복제·보관·관계변환은 후속 구현 범위다.
 *
 * 순수 게이트(resolveBulkColumnKey/bulkBlockReason/차단 집합)는
 * `./bulk-action-gates` 에 있다 — `"use server"` 파일은 async 함수만 export 한다.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { createRequestBoards } from "@/lib/boards/server";
import { userFacingMessage } from "@/lib/boards/boardActionFlash";
import { workflowKindForSource, type WorkflowProgressKind } from "@/lib/workflow/progress";
import type { CellValue } from "@/lib/boards/types";
import { BULK_MAX_ITEMS } from "@/components/board/bulk-selection";
import { bulkBlockReason, resolveBulkColumnKey } from "./bulk-action-gates";
import { isSourceEditable } from "@/lib/field/source";
import { notifyBoardItemMoved } from "@/lib/notify/board-actions";
import {
  AssignmentLineageService,
  AssignmentLineageUnavailableError,
  SupabaseAssignmentLineageRepo,
} from "@/lib/assignment-lineage";

export type BulkItemResult = {
  itemId: string;
  ok: boolean;
  message: string;
};

export type BulkApplyResult = {
  ok: boolean;
  applied: number;
  failed: number;
  results: BulkItemResult[];
};

function allFailed(itemIds: readonly string[], message: string): BulkApplyResult {
  return {
    ok: false,
    applied: 0,
    failed: itemIds.length,
    results: itemIds.map((itemId) => ({ itemId, ok: false as const, message })),
  };
}

function toResult(
  processed: BulkItemResult[],
  skipped: readonly string[],
  skipMessage: string,
): BulkApplyResult {
  const results: BulkItemResult[] = [
    ...processed,
    ...skipped.map((itemId) => ({ itemId, ok: false as const, message: skipMessage })),
  ];
  const applied = results.filter((r) => r.ok).length;
  return { ok: applied > 0 && applied === results.length, applied, failed: results.length - applied, results };
}

/**
 * 클라이언트가 보낸 workflowKind는 신뢰하지 않는다 — 실제 보드의 source가 정본이다.
 * 잘못된 kind는 던지지 않고 구조적 실패로 닫는다 (서버 액션은 항상 BulkApplyResult).
 */
const VALID_BULK_KINDS: ReadonlySet<string> = new Set(["new-lead", "contact", "work"]);

function isMalformedBulkKind(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value !== "string" || !VALID_BULK_KINDS.has(value);
}

function actualKindForBoard(board: { source?: string | null } | null | undefined): WorkflowProgressKind | null {
  if (!board || typeof board.source !== "string") return null;
  return workflowKindForSource(board.source);
}

const SYSTEM_BOARD_MESSAGE =
  "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다";

async function requireBulkPermission(): Promise<{ ok: true; ctx: Awaited<ReturnType<typeof getSession>> } | { ok: false; message: string }> {
  try {
    const ctx = await getSession();
    const permission = await loadPermGuard(ctx.org.id, "work.item_upsert");
    if (permission.kind !== "allowed") {
      return {
        ok: false,
        message:
          permission.reason === "permission"
            ? "이 업무를 실행할 권한이 없어요."
            : "권한을 확인하지 못했어요.",
      };
    }
    return { ok: true, ctx };
  } catch (error) {
    return { ok: false, message: userFacingMessage(error) };
  }
}

function canSeeAll(ctx: { role: string; scope: string }): boolean {
  return ctx.role === "owner" || ctx.role === "admin" || ctx.scope === "all";
}

function lineageErrorMessage(error: unknown): string {
  if (error instanceof AssignmentLineageUnavailableError) {
    if (error.code === "40001") {
      return "담당자 정보가 먼저 변경되었습니다. 새로 불러온 뒤 다시 시도해 주세요.";
    }
    if (error.code === "42501") {
      return "이 담당자 흐름을 변경할 권한이 없습니다.";
    }
    if (error.code === "22023") {
      return "이전 요청과 내용이 달라 처리할 수 없습니다. 선택을 확인해 주세요.";
    }
  }
  return userFacingMessage(error);
}

/** 셀 일괄 — 상태·선택·날짜·텍스트·숫자·담당(person) 컬럼. 전이 열/값은 게이트가 막는다. */
export async function bulkApplyCellsAction(input: {
  boardId: string;
  itemIds: string[];
  columnKey: string;
  value: CellValue;
  workflowKind: WorkflowProgressKind | null;
}): Promise<BulkApplyResult> {
  const ids = [...new Set(input.itemIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };
  // 사용자 제어 kind는 차단 매핑을 바꿀 수 없다 — 실제 보드가 정본이다.
  // 깨진 kind는 던지지 않고 구조적 실패로 닫는다.
  if (isMalformedBulkKind((input as { workflowKind?: unknown }).workflowKind)) {
    return allFailed(ids, "요청 정보가 올바르지 않습니다.");
  }

  const gate = await requireBulkPermission();
  if (!gate.ok) return allFailed(ids, gate.message);

  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  // 존재하지 않는 컬럼은 서비스가 조용히 무시한다(EAV 오염 방지 continue → errors=[]).
  // 그 자리에 가만히 두면 없는 칸에 «저장했습니다» 가 된다 — 쓰기 전에 실제 기록 칸인지 확인한다.
  // 실제 보드를 먼저 읽어 is_system을 거부하고, kind 매핑도 실제 보드에서 가져온다.
  let columnKey: string;
  let isStatusColumn = false;
  try {
    const detail = await graph.service.getBoardDetail(gate.ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed(ids, SYSTEM_BOARD_MESSAGE);
    }
    const actualKind = actualKindForBoard(detail.board);
    const blocked = bulkBlockReason(input.columnKey, input.value, actualKind);
    if (blocked) return allFailed(ids, blocked);
    columnKey = resolveBulkColumnKey(input.columnKey, actualKind);
    const column = detail.columns.find((candidate) => candidate.key === columnKey);
    if (!column) {
      return allFailed(ids, "기록 항목을 찾을 수 없어요.");
    }
    isStatusColumn = column.type === "status";
    if (!isSourceEditable(column.source) || column.is_readonly === true) {
      const message =
        column.is_readonly === true
          ? "자동 계산되는 칸이라 손으로 고칠 수 없습니다"
          : "자동으로 채워지는 칸은 직접 바꿀 수 없습니다";
      return allFailed(ids, message);
    }
    // person/people 컬럼의 조직 멤버 검증 — setCellAction 과 같은 조건 (연결된 워크스페이스에서만).
    if (graph.client && (column.type === "person" || column.type === "people")) {
      const wanted = (Array.isArray(input.value) ? input.value : input.value ? [input.value] : []).filter(
        (entry): entry is string => typeof entry === "string",
      );
      if (wanted.length > 0) {
        const members = await graph.client
          .from("org_members")
          .select("user_id")
          .eq("org_id", gate.ctx.org.id)
          .eq("status", "active")
          .in("user_id", wanted);
        if (
          members.error ||
          new Set((members.data ?? []).map((member) => member.user_id)).size !== new Set(wanted).size
        ) {
          return allFailed(ids, "이 회사에 속한 사람만 선택할 수 있어요.");
        }
      }
    }
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  const processed: BulkItemResult[] = [];
  for (const itemId of head) {
    try {
      const { errors } = await graph.service.setCells(
        gate.ctx,
        input.boardId,
        itemId,
        { [columnKey]: input.value },
        crypto.randomUUID(),
      );
      if (errors.length > 0) {
        processed.push({ itemId, ok: false, message: errors[0]?.message ?? "값을 저장하지 못했어요." });
      } else {
        let message = "저장했습니다.";
        if (graph.client && isStatusColumn) {
          try {
            await notifyBoardItemMoved(graph.client, gate.ctx, { boardId: input.boardId, itemId, eventKey: crypto.randomUUID() });
          } catch {
            message = "저장했습니다. 담당자 알림은 전달하지 못했습니다.";
          }
        }
        processed.push({ itemId, ok: true, message });
      }
    } catch (error) {
      processed.push({ itemId, ok: false, message: userFacingMessage(error) });
    }
  }
  if (processed.some((r) => r.ok)) revalidatePath(`/boards/${input.boardId}`);
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}

/**
 * 담당자 일괄 — 정본 경로를 그대로 쓴다.
 *
 *  - deal 연결 행: `reassign_deal_with_lineage` RPC
 *    (AssignmentLineagePopover 의 reassignAssignmentAction 과 동일 —
 *    deals/items/owner EAV/lineage version/history 보존, scope·멤버·버전은 RPC 가 강제).
 *  - 비연결 행: 기존 `updateItem({ assigned_to })` 정책 유지
 *    (멤버 검증 + board 소속 사전 확인 + 전체가시 scope 강제).
 *
 * 순서가 계약이다: 쓰기 전에 `getItem(boardId, itemId)` 로
 * «이 보드의 행» 임을 먼저 확인한다. updateItem(repo)은 org+id 만 보고
 * 같은 조직의 다른 보드 행도 갱신하므로, 확인을 뒤로 미루면
 * 다른 보드에 부작용을 낸 뒤에야 거부된다.
 */
export async function bulkAssignAction(input: {
  boardId: string;
  itemIds: string[];
  assigneeId: string | null;
}): Promise<BulkApplyResult> {
  const ids = [...new Set(input.itemIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  const gate = await requireBulkPermission();
  if (!gate.ok) return allFailed(ids, gate.message);

  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  // deal 분기의 lineage.reassign은 board.is_system을 스스로 검사하지 않는다(RLS는 scope·멤버·버전만 강제).
  // 모든 쓰기 전에 실제 보드를 읽어 시스템 보드를 거부한다 — getItem만으로는 막히지 않는다.
  try {
    const detail = await graph.service.getBoardDetail(gate.ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed(ids, SYSTEM_BOARD_MESSAGE);
    }
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  if (graph.client && input.assigneeId) {
    try {
      const members = await graph.client
        .from("org_members")
        .select("user_id")
        .eq("org_id", gate.ctx.org.id)
        .eq("status", "active")
        .in("user_id", [input.assigneeId]);
      if (members.error || (members.data ?? []).length !== 1) {
        return allFailed(ids, "이 회사에 속한 사람만 선택할 수 있어요.");
      }
    } catch (error) {
      return allFailed(ids, userFacingMessage(error));
    }
  }

  // 비연결 행의 기존 정책: assigned_to 는 전체가시만 바꿀 수 있다.
  // scoped(repo)는 조용히 빼고 저장하므로 — 여기서 먼저 막아 거짓 성공을 막는다.
  const allowDirectAssign = canSeeAll(gate.ctx);

  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  const processed: BulkItemResult[] = [];
  for (const itemId of head) {
    try {
      // ① 소속·가시성 확인이 쓰기보다 먼저다.
      const item = await graph.service.getItem(gate.ctx, input.boardId, itemId);
      if (item.deal_id) {
        // ② deal 연결 — 정본 lineage RPC만 쓴다. legacy 직접 쓰기 금지(migration134/135).
        if (!graph.client) {
          processed.push({ itemId, ok: false, message: "담당자 변경: 이 동작은 연결된 워크스페이스가 필요합니다." });
          continue;
        }
        const actor = { orgId: gate.ctx.org.id, userId: gate.ctx.user.id };
        const lineage = new AssignmentLineageService(
          new SupabaseAssignmentLineageRepo(graph.client),
        );
        const ref = { boardId: input.boardId, dealId: item.deal_id, itemId };
        let snapshot;
        try {
          snapshot = await lineage.read(actor, ref);
        } catch (error) {
          processed.push({ itemId, ok: false, message: lineageErrorMessage(error) });
          continue;
        }
        try {
          await lineage.reassign(actor, {
            ...ref,
            assignedTo: input.assigneeId,
            expectedAssignedTo: snapshot.currentAssigneeId,
            expectedVersion: snapshot.version,
            requestId: crypto.randomUUID(),
          });
          processed.push({ itemId, ok: true, message: "저장했습니다." });
        } catch (error) {
          processed.push({ itemId, ok: false, message: lineageErrorMessage(error) });
        }
        continue;
      }
      // ③ 비연결 행 — 기존 updateItem 정책을 유지한다.
      if (!allowDirectAssign) {
        processed.push({ itemId, ok: false, message: "전체 행을 볼 수 있는 사용자만 담당자를 바꿀 수 있어요." });
        continue;
      }
      await graph.service.updateItem(gate.ctx, input.boardId, itemId, {
        assigned_to: input.assigneeId,
      });
      processed.push({ itemId, ok: true, message: "저장했습니다." });
    } catch (error) {
      processed.push({ itemId, ok: false, message: userFacingMessage(error) });
    }
  }
  if (processed.some((r) => r.ok)) revalidatePath(`/boards/${input.boardId}`);
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}

/**
 * 그룹 이동 일괄 — 정본 `moveRowAtomic` 한 경로만 쓴다.
 *
 * 직접 `updateItem({ group_id })` 는 migration139 RPC-only 트리거에 막힌다
 * («board row position is RPC-only»). 정본과 같은 권한(전체 행 가시)·
 * 순서(대상 그룹 맨 끝)·버전(expectedVersion 추적)·그룹 소속·상태 의미를 쓴다.
 */
export async function bulkMoveGroupAction(input: {
  boardId: string;
  itemIds: string[];
  groupId: string | null;
}): Promise<BulkApplyResult> {
  const ids = [...new Set(input.itemIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, applied: 0, failed: 0, results: [] };

  const gate = await requireBulkPermission();
  if (!gate.ok) return allFailed(ids, gate.message);
  if (!canSeeAll(gate.ctx)) {
    return allFailed(ids, "전체 행을 볼 수 있는 사용자만 행을 옮길 수 있어요.");
  }

  let graph: Awaited<ReturnType<typeof createRequestBoards>>;
  try {
    graph = await createRequestBoards();
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  let expectedVersion: number;
  try {
    const detail = await graph.service.getBoardDetail(gate.ctx, input.boardId);
    if (detail.board.is_system) {
      return allFailed(ids, "시스템 보드는 편집할 수 없습니다 — 정책자금 파이프라인은 딜 화면에서 관리합니다");
    }
    if (input.groupId !== null && !detail.groups.some((group) => group.id === input.groupId)) {
      return allFailed(ids, "그룹을 찾을 수 없습니다");
    }
    expectedVersion = detail.board.row_order_version ?? 0;
  } catch (error) {
    return allFailed(ids, userFacingMessage(error));
  }

  const head = ids.slice(0, BULK_MAX_ITEMS);
  const tail = ids.slice(BULK_MAX_ITEMS);
  const processed: BulkItemResult[] = [];
  for (const itemId of head) {
    try {
      // 소속 확인이 쓰기보다 먼저다 — 다른 보드 행의 순서·그룹을 건드리지 않는다.
      await graph.service.getItem(gate.ctx, input.boardId, itemId);
      const receipt = await graph.service.moveRowAtomic(gate.ctx, input.boardId, {
        itemId,
        targetGroupId: input.groupId,
        beforeItemId: null,
        expectedVersion,
        requestId: crypto.randomUUID(),
      });
      expectedVersion = receipt.version;
      processed.push({ itemId, ok: true, message: "옮겼습니다." });
    } catch (error) {
      processed.push({ itemId, ok: false, message: userFacingMessage(error) });
    }
  }
  if (processed.some((r) => r.ok)) revalidatePath(`/boards/${input.boardId}`);
  return toResult(processed, tail, `한 번에 ${BULK_MAX_ITEMS}개까지 처리합니다. 나머지는 나눠서 실행해 주세요.`);
}
