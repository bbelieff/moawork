"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
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

export async function revokeAllSessions() {
  await getSession();
  await revokeAllMemberSessions(crypto.randomUUID());
  revalidatePath("/settings/account/sessions");
}

export async function requestPrivacyExport() {
  const ctx = await getSession();
  await requestMyPrivacyExport(crypto.randomUUID(), ctx.org.id);
  revalidatePath("/settings/account/privacy");
}
