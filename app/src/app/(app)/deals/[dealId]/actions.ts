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
import { getCrmService, ValidationError } from "@/lib/crm";
import { addComment, editComment, type CommentKind } from "@/lib/deal/comments";
import { attachDealFile, removeDealFile, type NewDealFileInput } from "@/lib/deal/files";
import { listOrgMemberOptions } from "@/lib/deal/members";
import {
  notifyFollowupRequested,
  notifyMentions,
  type FollowupNotificationOutcome,
} from "@/lib/deal/notify";

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
    fee_terms: str(formData, "fee_terms") || null,
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

// BBE-16 · 딜 상세 협업(타임라인·댓글·파일) — 프로덕션 영속 경로.

/** 댓글 작성. mentionedIds 가 있으면 저장 후 해당 멤버에게 알림을 보낸다. */
export async function addCommentAction(
  dealId: string,
  input: { body: string; mentionedIds?: string[]; kind?: CommentKind },
): Promise<void> {
  const ctx = await getSession();
  const members = await listOrgMemberOptions(ctx);
  const allowedIds = new Set(members.map((member) => member.id));
  const mentionedIds = [...new Set(input.mentionedIds ?? [])].filter((id) => allowedIds.has(id));
  const comment = await addComment(ctx, dealId, { ...input, mentionedIds });
  if (mentionedIds.length) await notifyMentions(ctx, dealId, mentionedIds, comment.id);
  revalidatePath(`/deals/${dealId}`);
}

/** 댓글 수정. expectedVersion 불일치 시 ConcurrentEditError 가 그대로 던져진다. */
export async function editCommentAction(
  dealId: string,
  commentId: string,
  input: { body: string; expectedVersion: number },
): Promise<void> {
  const ctx = await getSession();
  await editComment(ctx, dealId, commentId, input);
  revalidatePath(`/deals/${dealId}`);
}

/**
 * 되돌려보내기(보완요청). 사유를 "보완요청" 종류 댓글로 남기고, 현재 담당자에게
 * `requested` 알림을 보낸다. 사유는 필수(빈 문자열이면 addComment 가 거부한다).
 */
export async function requestFollowupAction(
  dealId: string,
  reason: string,
): Promise<FollowupNotificationOutcome> {
  const ctx = await getSession();
  const comment = await addComment(ctx, dealId, { body: reason, kind: "return_request" });
  const outcome = await notifyFollowupRequested(ctx, dealId, comment.id);
  revalidatePath(`/deals/${dealId}`);
  return outcome;
}

/**
 * 담당자 재배정. 이름 표시는 이 액션이 조직 멤버 목록으로 직접 해석한다
 * (클라이언트가 준 이름 문자열을 신뢰하지 않는다 — 활동로그 위조 방지).
 */
export async function reassignDealAction(
  dealId: string,
  newAssignedTo: string | null,
): Promise<void> {
  const ctx = await getSession();
  const before = await getCrmService().getDeal(ctx, dealId);
  const members = await listOrgMemberOptions(ctx);
  if (newAssignedTo && !members.some((member) => member.id === newAssignedTo)) {
    throw new ValidationError("같은 회사의 구성원만 담당자로 지정할 수 있어요.");
  }
  const nameOf = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? null) : null);

  await getCrmService().reassignDeal(ctx, dealId, newAssignedTo, {
    fromName: nameOf(before.assigned_to),
    toName: nameOf(newAssignedTo),
  });
  revalidatePath(`/deals/${dealId}`);
}

/** 첨부 업로드 — 비동기 경로(프로덕션에서도 영속). 서명 URL 로만 다운로드한다. */
export async function attachDealFileAction(dealId: string, input: NewDealFileInput): Promise<void> {
  const ctx = await getSession();
  await attachDealFile(ctx, dealId, input);
  revalidatePath(`/deals/${dealId}`);
}

export async function removeDealFileAction(dealId: string, fileId: string): Promise<void> {
  const ctx = await getSession();
  await removeDealFile(ctx, dealId, fileId);
  revalidatePath(`/deals/${dealId}`);
}
