"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { requestMyPrivacyExport, revokeAllMemberSessions, revokeCurrentMemberSession } from "@/lib/account/memberAccountOps";

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
