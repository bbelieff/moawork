"use server";

/**
 * 임의 보드 서버 액션 (T02b · ADR-0003).
 * 로컬 스토어가 서버 인메모리(globalThis)라 서버 액션으로 직접 조작하고 revalidate 한다.
 * (Supabase 연결 후에도 동일 서비스 호출 — 어댑터만 교체)
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getBoardsService } from "@/lib/boards";
import { parseNewBoard, parseNewColumn, parseNewItem, isFieldType } from "@/lib/boards/validation";
import type { FieldOption } from "@/lib/types";
import type { CellValue } from "@/lib/boards/types";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
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
  const input = parseNewBoard({
    name: str(formData, "name"),
    description: str(formData, "description"),
    icon: str(formData, "icon"),
  });
  const detail = getBoardsService().createBoard(ctx, input);
  revalidatePath("/boards");
  redirect(`/boards/${detail.board.id}`);
}

export async function deleteBoardAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  getBoardsService().deleteBoard(ctx, str(formData, "boardId"));
  revalidatePath("/boards");
  redirect("/boards");
}

export async function addColumnAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  const type = str(formData, "type");
  if (!isFieldType(type)) throw new Error("지원하지 않는 필드 타입입니다");
  const optionsCsv = str(formData, "options");
  const input = parseNewColumn({
    label: str(formData, "label"),
    type,
    options: optionsCsv ? parseOptionsCsv(optionsCsv) : undefined,
  });
  getBoardsService().addColumn(ctx, boardId, input);
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteColumnAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  getBoardsService().deleteColumn(ctx, boardId, str(formData, "columnId"));
  revalidatePath(`/boards/${boardId}`);
}

export async function addItemAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  const groupId = str(formData, "groupId");
  const input = parseNewItem({
    title: str(formData, "title"),
    group_id: groupId === "" ? null : groupId,
  });
  getBoardsService().createItem(ctx, boardId, input);
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  getBoardsService().deleteItem(ctx, boardId, str(formData, "itemId"));
  revalidatePath(`/boards/${boardId}`);
}

/** 셀 인라인 편집 — 값 정규화·선택지 검증은 서비스가 수행. */
export async function setCellAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  const itemId = str(formData, "itemId");
  const columnKey = str(formData, "columnKey");
  const raw = formData.get("value");
  // 체크박스는 미체크 시 필드가 아예 없다 → false 로 수렴.
  const value: CellValue =
    str(formData, "kind") === "checkbox" ? raw === "on" || raw === "true" : (raw as CellValue);
  getBoardsService().setCells(ctx, boardId, itemId, { [columnKey]: value });
  revalidatePath(`/boards/${boardId}`);
}

/** 아이템 제목 수정. */
export async function renameItemAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  getBoardsService().updateItem(ctx, boardId, str(formData, "itemId"), {
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
  const boardId = str(formData, "boardId");
  const itemId = str(formData, "itemId");
  const lane = str(formData, "lane");
  const groupBy = str(formData, "groupBy");
  const svc = getBoardsService();
  if (groupBy) {
    svc.setCells(ctx, boardId, itemId, { [groupBy]: lane === "" ? null : lane });
  } else {
    svc.updateItem(ctx, boardId, itemId, { group_id: lane === "" ? null : lane });
  }
  revalidatePath(`/boards/${boardId}`);
}

export async function addGroupAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const boardId = str(formData, "boardId");
  getBoardsService().addGroup(ctx, boardId, { name: str(formData, "name") });
  revalidatePath(`/boards/${boardId}`);
}
