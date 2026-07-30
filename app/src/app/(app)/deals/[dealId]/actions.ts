"use server";

/**
 * 딜 상세 서버 액션 (T02).
 *
 * 저장은 전부 `getCrmService()`(비동기 서비스) 를 거친다 — 환경변수가 있으면 실 Supabase,
 * 없으면 로컬 인메모리. 화면 코드는 어느 쪽인지 몰라도 된다.
 *
 * 단계 이동은 `moveDealStage` 만 쓴다(활동로그 보장). `updateDeal` 로는 단계를 못 바꾼다.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { getCrmService } from "@/lib/crm";
import { attachFile, removeFile } from "@/lib/services/files";
import { getRepo } from "@/lib/repo";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** 파이프라인 단계 이동 — 활동로그가 함께 남는다. */
export async function moveStageAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const dealId = str(formData, "dealId");
  const stageId = str(formData, "stageId");
  if (!dealId || !stageId) return;

  await getCrmService().moveDealStage(ctx, dealId, stageId);
  revalidatePath(`/deals/${dealId}`);
  // 보드 3종도 단계 구성이 바뀌므로 함께 갱신.
  for (const p of ["/newcust", "/contract", "/work"]) revalidatePath(p);
}

/** 활동기록 추가(메모/통화/미팅). */
export async function addActivityAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const dealId = str(formData, "dealId");
  const content = str(formData, "content");
  const type = str(formData, "type") || "memo";
  if (!dealId || !content) return;

  await getCrmService().createActivity(ctx, dealId, { type, content });
  revalidatePath(`/deals/${dealId}`);
}

/** 딜 기본정보 수정(제목·금액·상태메모). 단계는 여기서 바꾸지 않는다. */
export async function updateDealAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const dealId = str(formData, "dealId");
  if (!dealId) return;

  const rawAmount = str(formData, "amount");
  await getCrmService().updateDeal(ctx, dealId, {
    title: str(formData, "title") || undefined,
    status_note: str(formData, "status_note") || null,
    amount: rawAmount === "" ? null : Number(rawAmount.replace(/[,\s]/g, "")),
  });
  revalidatePath(`/deals/${dealId}`);
}

/**
 * 계약상황(커스텀필드) 저장.
 * 값은 001 정본대로 `deals.custom[fieldKey]` 에 들어간다(contracts 테이블 없음 — Phase 2).
 * custom 은 포트 규약상 **키 단위 병합**이라 다른 커스텀값을 덮지 않는다.
 */
export async function setContractStatusAction(
  dealId: string,
  fieldKey: string,
  value: string | null,
): Promise<void> {
  const ctx = await getSession();
  if (!dealId || !fieldKey) return;

  await getCrmService().updateDeal(ctx, dealId, { custom: { [fieldKey]: value } });
  revalidatePath(`/deals/${dealId}`);
}

/**
 * 첨부 업로드/삭제 (T04 core.files 서비스 위임).
 *
 * ⚠ files 서비스는 아직 **동기 `getRepo()`** 위에서 돈다(T04 소유). 그래서 이 두 액션만
 * 로컬 인메모리에 기록되고 Supabase 로는 가지 않는다. 딜 본문/단계/활동과 저장소가
 * 갈리는 지점이라 T04 가 비동기 소스로 옮길 때까지의 한시적 상태다.
 */
export async function uploadFileAction(
  dealId: string,
  input: { name: string; mime_type: string; size_bytes: number; data_url: string },
): Promise<void> {
  const ctx = await getSession();
  attachFile(ctx, dealId, input);
  revalidatePath(`/deals/${dealId}`);
}

export async function removeFileAction(
  dealId: string,
  fileId: string,
): Promise<void> {
  const ctx = await getSession();
  removeFile(ctx, dealId, fileId);
  revalidatePath(`/deals/${dealId}`);
}

/** 첨부 목록 — 위와 같은 이유로 동기 repo 에서 읽는다. */
export async function readDealCustomKey(
  dealId: string,
): Promise<Record<string, unknown>> {
  const ctx = await getSession();
  const deal = getRepo().getDeal(ctx, dealId);
  return (deal?.custom ?? {}) as Record<string, unknown>;
}
