"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { requestMyPrivacyExport, revokeAllMemberSessions, revokeCurrentMemberSession } from "@/lib/account/memberAccountOps";
import { requestWorkspaceDeletion, restoreWorkspaceDeletion } from "@/lib/workspace-deletion/server";

export type WorkspaceDeletionActionState = { kind: "idle" | "success" | "error"; message: string };

export async function requestWorkspaceDeletionAction(_state: WorkspaceDeletionActionState, formData: FormData): Promise<WorkspaceDeletionActionState> {
  await getSession();
  const orgId = String(formData.get("orgId") ?? "");
  const workspaceName = String(formData.get("workspaceName") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (!orgId || !workspaceName || confirmation !== workspaceName) return { kind: "error", message: "회사 이름을 정확히 입력해 주세요." };
  try {
    await requestWorkspaceDeletion(orgId, confirmation);
    revalidatePath("/settings/account"); revalidatePath("/workspaces");
    return { kind: "success", message: "회사를 삭제 예정으로 바꿨어요." };
  } catch {
    return { kind: "error", message: "회사 삭제를 예약하지 못했어요. 대표 권한과 현재 상태를 확인해 주세요." };
  }
}

export async function restoreWorkspaceDeletionAction(_state: WorkspaceDeletionActionState, formData: FormData): Promise<WorkspaceDeletionActionState> {
  await getSession();
  const orgId = String(formData.get("orgId") ?? "");
  if (!orgId) return { kind: "error", message: "되돌릴 회사를 확인할 수 없어요." };
  try {
    await restoreWorkspaceDeletion(orgId);
    revalidatePath("/settings/account"); revalidatePath("/workspaces");
    return { kind: "success", message: "회사를 다시 사용할 수 있어요." };
  } catch {
    return { kind: "error", message: "삭제 예정을 되돌리지 못했어요. 대표 권한과 현재 상태를 확인해 주세요." };
  }
}

export async function revokeCurrentSession(formData: FormData) {
  await getSession();
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) throw new Error("session_required");
  await revokeCurrentMemberSession(crypto.randomUUID(), sessionId);
  revalidatePath("/settings/account/sessions");
}

/**
 * 모든 기기에서 로그아웃 (QA #887).
 *
 * 전에는 기기 목록 표의 행만 «로그아웃» 으로 표시했고(목록은 채우는 곳이 없어 늘 비어 있었다),
 * Supabase 로그인 자체는 어느 기기에서도 끝나지 않았다 — 잃어버린 휴대폰이 그대로 로그인돼 있었다.
 * 이제 Supabase 의 전체 로그아웃(scope: global)으로 모든 기기의 갱신 토큰을 끊고, 이 기기도 로그아웃한다.
 * 다른 기기는 이미 받은 접속 토큰이 끝나는 대로(보통 한 시간 이내) 로그인 화면으로 간다.
 *
 * 실패해도 이 기기는 이미 로그아웃된 상태일 수 있다(Supabase 가 서버 오류 전에 이 기기 세션을 먼저 지운다).
 * 그래서 실패는 설정 화면이 아니라 로그인 화면에서 «다른 기기는 안 끊겼을 수 있다» 고 알린다.
 */
export async function revokeAllSessions() {
  await getSession();
  let failed = false;
  if (hasSupabaseEnv()) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signOut({ scope: "global" });
      failed = Boolean(error);
    } catch {
      failed = true;
    }
  }
  if (!failed) {
    try {
      await revokeAllMemberSessions(crypto.randomUUID());
    } catch {
      // 기기 기록 표는 보조 장부다 — 실제 로그아웃이 끝났으면 장부 실패로 되돌리지 않는다.
    }
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE.uid);
  jar.delete(SESSION_COOKIE.org);
  jar.delete(SESSION_COOKIE.as);
  redirect(failed ? "/login?error=signout-all-failed" : "/login?reason=signed-out-everywhere");
}

export async function requestPrivacyExport() {
  const ctx = await getSession();
  await requestMyPrivacyExport(crypto.randomUUID(), ctx.org.id);
  revalidatePath("/settings/account/privacy");
}
