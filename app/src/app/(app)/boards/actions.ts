"use server";

/**
 * 임의 보드 서버 액션 (T02b · ADR-0003).
 * 로컬 스토어가 서버 인메모리(globalThis)라 서버 액션으로 직접 조작하고 revalidate 한다.
 * (Supabase 연결 후에도 동일 서비스 호출 — 어댑터만 교체)
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { loadPermGuard } from "@/lib/perm/guard";
import { recordRiskyAction } from "@/lib/perm/server";
import { NotFoundError } from "@/lib/boards";
import { createRequestBoards } from "@/lib/boards/server";
import { parseNewBoard, parseNewColumn, parseNewItem, isFieldType } from "@/lib/boards/validation";
import type { Ctx, FieldOption } from "@/lib/types";
import type { ItemWithValues } from "@/lib/boards/types";
import { boardCellValueFromFormData } from "@/lib/boards/form-values";
import type { CellError } from "@/lib/boards/service";
import type { ItemPatch } from "@/lib/boards/store";
import { clampWidth, groupKeyOf } from "@/components/board/layout";
import { setGroupColumnOrder } from "./groupLayout";
import {
  CELL_FLASH_COOKIE,
  CELL_FLASH_MAX_AGE,
  encodeCellFlash,
} from "@/lib/boards/cellFlash";
import { encodeNoticeFile, NOTICE_FILE_VALUE_PREFIX } from "@/lib/notices/official-file";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

async function boardsService() {
  return (await createRequestBoards()).service;
}

async function requirePermission(ctx: Ctx, scopeKey: string, riskKey?: "danger.bulk_edit_delete"): Promise<void> {
  const permission = await loadPermGuard(ctx.org.id, scopeKey);
  if (permission.kind !== "allowed") throw new Error(permission.reason === "permission" ? "이 업무를 실행할 권한이 없어요." : "권한을 확인하지 못했어요.");
  if (riskKey && !(await recordRiskyAction(ctx.org.id, riskKey, { operation: scopeKey })).ok) {
    throw new Error("위험 작업 기록을 남기지 못해 실행하지 않았어요.");
  }
}

/**
 * 저장되지 못한 셀을 다음 렌더에 알린다(1회성 쿠키).
 *
 * setCells 는 관대 정책이라 **틀린 셀만 빼고 나머지는 저장**한 뒤 사유를 돌려준다.
 * 그 사유를 여기서 흘려버리면 사용자에겐 "아무 일도 안 일어난" 것으로 보인다 —
 * 조용한 실패를 없애려고 이 화면(서버 렌더 폼)에서 쓸 수 있는 방식으로 넘긴다.
 */
async function flashCellErrors(itemId: string, errors: CellError[]): Promise<void> {
  const encoded = encodeCellFlash({ itemId, errors });
  if (!encoded) return;
  const jar = await cookies();
  jar.set(CELL_FLASH_COOKIE, encoded, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: CELL_FLASH_MAX_AGE,
  });
}

/** "높음,보통,낮음" → FieldOption[] (id 는 안정적으로 파생). */
function parseOptionsCsv(csv: string): FieldOption[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((label, i) => ({ id: `opt-${i + 1}-${label.replace(/\s+/g, "")}`, label, order: i }));
}

export async function createBoardAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "structure.tab_manage");
  const input = parseNewBoard({
    name: str(formData, "name"),
    description: str(formData, "description"),
    icon: str(formData, "icon"),
  });
  const detail = await (await boardsService()).createBoard(ctx, input);
  revalidatePath("/boards");
  redirect(`/boards/${detail.board.id}`);
}

export async function deleteBoardAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "danger.bulk_edit_delete", "danger.bulk_edit_delete");
  await (await boardsService()).deleteBoard(ctx, str(formData, "boardId"));
  revalidatePath("/boards");
  redirect("/boards");
}

export async function addColumnAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "structure.column_manage");
  const boardId = str(formData, "boardId");
  const type = str(formData, "type");
  if (!isFieldType(type)) throw new Error("지원하지 않는 필드 타입입니다");
  const optionsCsv = str(formData, "options");
  const input = parseNewColumn({
    label: str(formData, "label"),
    type,
    options: optionsCsv ? parseOptionsCsv(optionsCsv) : undefined,
  });
  await (await boardsService()).addColumn(ctx, boardId, input);
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteColumnAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "structure.column_manage");
  const boardId = str(formData, "boardId");
  await (await boardsService()).deleteColumn(ctx, boardId, str(formData, "columnId"));
  revalidatePath(`/boards/${boardId}`);
}

/**
 * 컬럼 폭 조절(D12) — 머리글 경계 드래그·두 번 눌러 초기화.
 * `width` 가 빈 문자열이면 초기화(null = 컬럼 최소폭으로 되돌아감). 값이 있으면
 * 클라이언트가 이미 clampWidth 를 거쳤어도 여기서 한 번 더 좁힌다(직접 폼 제출 방어).
 */
export async function setColumnWidthAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "structure.column_manage");
  const boardId = str(formData, "boardId");
  const columnId = str(formData, "columnId");
  const raw = str(formData, "width");
  const width = raw === "" ? null : clampWidth(Number(raw));
  await (await boardsService()).updateColumn(ctx, boardId, columnId, { width });
  revalidatePath(`/boards/${boardId}`);
}

export async function addItemAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "work.item_upsert");
  const boardId = str(formData, "boardId");
  const groupId = str(formData, "groupId");
  const input = parseNewItem({
    title: str(formData, "title"),
    group_id: groupId === "" ? null : groupId,
  });
  await (await boardsService()).createItem(ctx, boardId, input);
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "work.item_delete");
  const boardId = str(formData, "boardId");
  await (await boardsService()).deleteItem(ctx, boardId, str(formData, "itemId"));
  revalidatePath(`/boards/${boardId}`);
}

/** 셀 인라인 편집 — 값 정규화·선택지 검증은 서비스가 수행. */
export async function setCellAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "work.item_upsert");
  const boardId = str(formData, "boardId");
  const itemId = str(formData, "itemId");
  const columnKey = str(formData, "columnKey");
  // 체크박스 미체크와 담당자 미배정을 각 타입의 빈 값으로 정규화한다.
  const graph = await createRequestBoards();
  const svc = graph.service;
  const raw = formData.get("value");
  let patch: Record<string, import("@/lib/boards/types").CellValue>;
  if (raw instanceof File && raw.size > 0) {
    const column = (await svc.getBoardDetail(ctx, boardId)).columns.find((candidate) => candidate.key === columnKey);
    if (column?.type !== "file") throw new Error("파일 컬럼이 아닙니다.");
    const stored = await encodeNoticeFile(raw);
    const item = await graph.repo.getItem(ctx, itemId);
    if (!item || item.board_id !== boardId) throw new NotFoundError("아이템을 찾을 수 없습니다");
    await graph.repo.setValues(ctx, itemId, { [columnKey]: stored.id, [`${NOTICE_FILE_VALUE_PREFIX}${columnKey}`]: JSON.stringify(stored) });
    revalidatePath(`/boards/${boardId}`);
    return;
  } else {
    patch = { [columnKey]: boardCellValueFromFormData(formData) };
  }
  const { errors } = await svc.setCells(ctx, boardId, itemId, patch);
  await flashCellErrors(itemId, errors);
  revalidatePath(`/boards/${boardId}`);
}

/** 아이템 제목 수정. */
export async function renameItemAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "work.item_upsert");
  const boardId = str(formData, "boardId");
  await (await boardsService()).updateItem(ctx, boardId, str(formData, "itemId"), {
    title: str(formData, "title"),
  });
  revalidatePath(`/boards/${boardId}`);
}

/**
 * 칸반 레인 이동. groupBy 가 select 컬럼이면 그 셀 값을, 아니면 group_id 를 바꾼다.
 * (dnd 라이브러리 도입 전까지 폼 기반 이동 — 결과는 동일)
 */
export async function moveItemAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "work.item_upsert");
  const boardId = str(formData, "boardId");
  const itemId = str(formData, "itemId");
  const lane = str(formData, "lane");
  const groupBy = str(formData, "groupBy");
  const svc = await boardsService();
  if (groupBy) {
    const { errors } = await svc.setCells(ctx, boardId, itemId, {
      [groupBy]: lane === "" ? null : lane,
    });
    await flashCellErrors(itemId, errors);
  } else {
    await svc.updateItem(ctx, boardId, itemId, { group_id: lane === "" ? null : lane });
  }
  revalidatePath(`/boards/${boardId}`);
}

export async function addGroupAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "structure.section_manage");
  const boardId = str(formData, "boardId");
  await (await boardsService()).addGroup(ctx, boardId, { name: str(formData, "name") });
  revalidatePath(`/boards/${boardId}`);
}

/**
 * 행 드래그 — 그룹 내 상하 이동과 그룹 간 이동을 **한 경로**로 처리한다 (PLAN-002 WO-2 ⓒ).
 *
 * 두 동작을 나누지 않은 이유: 그룹을 바꾸는 이동도 결국 "대상 그룹의 N번째 자리에 꽂는 것"
 * 이고, 나누면 같은 재색인 규칙이 두 벌 생긴다.
 *
 * 재색인은 **대상 그룹 전체**를 0..n-1 로 다시 매긴다. 삽입 위치에만 소수 sort_order 를
 * 끼워 넣는 방식은 반복하면 정밀도가 무너져 순서가 뒤섞인다(무증상 파손) — 그래서 매번
 * 정수로 다시 세운다. 그룹당 행 수 규모에서는 이 비용이 문제되지 않는다.
 */
export async function moveRowAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "work.item_upsert");
  const boardId = str(formData, "boardId");
  const itemId = str(formData, "itemId");
  const rawGroup = str(formData, "groupId");
  const groupId = rawGroup === "" ? null : rawGroup;
  const requested = Number.parseInt(str(formData, "index"), 10);

  const svc = await boardsService();
  const items = await svc.listItems(ctx, boardId);
  const moving = items.find((i) => i.id === itemId);
  if (!moving) throw new NotFoundError("아이템을 찾을 수 없습니다");

  const targetKey = groupKeyOf(groupId);
  const siblings: ItemWithValues[] = items
    .filter((i) => i.id !== itemId && groupKeyOf(i.group_id) === targetKey)
    .sort((a, b) => a.sort_order - b.sort_order);

  const at = Number.isNaN(requested)
    ? siblings.length
    : Math.max(0, Math.min(requested, siblings.length));
  siblings.splice(at, 0, moving);

  await Promise.all(siblings.map(async (item, index) => {
    const patch: ItemPatch = { sort_order: index };
    // 그룹이 실제로 바뀐 행에만 group_id 를 싣는다(불필요한 쓰기 금지).
    if (item.id === itemId && groupKeyOf(item.group_id) !== targetKey) patch.group_id = groupId;
    await svc.updateItem(ctx, boardId, item.id, patch);
  }));

  revalidatePath(`/boards/${boardId}`);
}

/**
 * 그룹별 컬럼 배치 저장 (PLAN-002 WO-2 ⓑ).
 *
 * 저장하는 것은 **배치뿐**이다 — 컬럼을 만들거나 지우지 않으므로 셀 값(EAV)은 영향받지 않고,
 * 다른 그룹의 배치도 건드리지 않는다("그룹 간 독립 배치").
 *
 * 인가: 저장소 자체는 권한을 모른다. 여기서 `getBoardDetail` 을 먼저 호출해 이 세션이
 * 그 보드를 볼 수 있는지 확인하고(없으면 NotFoundError), 통과한 조직 id 로만 키를 만든다.
 */
export async function setGroupColumnOrderAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  await requirePermission(ctx, "structure.column_manage");
  const boardId = str(formData, "boardId");
  const groupKey = str(formData, "groupKey");

  // 접근 권한 확인 겸 유효 컬럼 목록 확보.
  const { columns } = await (await boardsService()).getBoardDetail(ctx, boardId);
  const valid = new Set(columns.map((c) => c.key));

  const order = str(formData, "order")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "" && valid.has(s));

  setGroupColumnOrder(ctx.org.id, boardId, groupKey, order);
  revalidatePath(`/boards/${boardId}`);
}
