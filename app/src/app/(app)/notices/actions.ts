"use server";

/**
 * 공지사항 서버 액션 (T04).
 * 보드 액션(T02b)과 같은 방식 — 폼 → 서버 액션 → revalidate. 클라이언트 JS 불필요.
 * 검증은 @/lib/notices/http 의 파서를 재사용해 API 경로와 규칙을 일치시킨다.
 */

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { getNoticesService, todayKst } from "@/lib/notices";
import { parseNewNotice, parseNoticePatch } from "@/lib/notices/http";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

/** 빈 문자열은 "미지정"(null) 으로 수렴 — 폼은 값을 비워 보낼 수 있어야 한다. */
function orNull(value: string): string | null {
  return value === "" ? null : value;
}

function revalidateNotices(): void {
  revalidatePath("/notices");
  revalidatePath("/"); // 홈 최근 공지 위젯
}

export async function createNoticeAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const input = parseNewNotice({
    title: str(formData, "title"),
    body: str(formData, "body"),
    categoryId: orNull(str(formData, "categoryId")),
    pinned: formData.get("pinned") === "on",
    publishedAt: orNull(str(formData, "publishedAt")),
    endedAt: orNull(str(formData, "endedAt")),
    audienceId: orNull(str(formData, "audienceId")),
  });
  // 권한 검사는 서비스가 한다 — 폼을 숨기는 것만으로는 막히지 않는다.
  getNoticesService().create(ctx, input);
  revalidateNotices();
}

export async function updateNoticeAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  const patch = parseNoticePatch({
    title: str(formData, "title"),
    body: str(formData, "body"),
    categoryId: orNull(str(formData, "categoryId")),
    pinned: formData.get("pinned") === "on",
    publishedAt: orNull(str(formData, "publishedAt")),
    endedAt: orNull(str(formData, "endedAt")),
    audienceId: orNull(str(formData, "audienceId")),
  });
  getNoticesService().update(ctx, str(formData, "noticeId"), patch);
  revalidateNotices();
}

/** 게시 종료 — 오늘로 종료일을 찍는다(삭제하지 않고 이력을 남긴다). */
export async function endNoticeAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  getNoticesService().update(ctx, str(formData, "noticeId"), { endedAt: todayKst() });
  revalidateNotices();
}

/** 게시 재개 — 종료일을 지운다. */
export async function resumeNoticeAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  getNoticesService().update(ctx, str(formData, "noticeId"), { endedAt: null });
  revalidateNotices();
}

/** 상단고정 토글 — 목록에서 한 번에. */
export async function toggleNoticePinAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  getNoticesService().update(ctx, str(formData, "noticeId"), {
    pinned: str(formData, "pinned") !== "true",
  });
  revalidateNotices();
}

export async function deleteNoticeAction(formData: FormData): Promise<void> {
  const ctx = await getSession();
  getNoticesService().remove(ctx, str(formData, "noticeId"));
  revalidateNotices();
}
