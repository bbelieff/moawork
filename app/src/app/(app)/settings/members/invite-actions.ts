"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { isManager } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import {
  checkInviteCreate,
  inviteCreateProblemMessage,
  isInviteRole,
  isInviteScope,
  isInviteToken,
  type InviteActionState,
  type InviteRole,
  type InviteScope,
} from "@/lib/org/invite-links";

/**
 * 「사람 부르기」 — 링크를 만들고, 끈다.
 *
 * ★ 진짜 관문은 148 의 SECURITY DEFINER 함수다. 여기 검사는 «눌렀는데 빨간 글씨가 뜨는» 경험을
 *   줄이기 위한 것이고, 그것만 믿지 않는다. 화면에서 버튼을 감추는 것으로는 아무것도 못 막는다.
 */

function fail(message: string): InviteActionState {
  return { kind: "error", message };
}

function readNullableNumber(formData: FormData, key: string): number | null | "bad" {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : "bad";
}

export async function createInviteLinkAction(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const ctx = await getSession();
  if (!isManager(ctx.role)) return fail("이 회사에 사람을 부를 수 있는 건 대표와 관리자예요.");

  const role = formData.get("role");
  const scope = formData.get("scope");
  if (!isInviteRole(role) || !isInviteScope(scope)) return fail("자리와 범위를 다시 골라 주세요.");

  const days = readNullableNumber(formData, "days");
  const maxUses = readNullableNumber(formData, "maxUses");
  if (days === "bad" || maxUses === "bad") return fail("숫자만 넣어 주세요.");

  const problem = checkInviteCreate({ role: role as InviteRole, scope: scope as InviteScope, days, maxUses });
  if (problem) return fail(inviteCreateProblemMessage(problem));

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_org_invite_link", {
      p_org_id: ctx.org.id,
      p_role: role,
      p_scope: scope,
      p_expires_in_days: days,
      p_max_uses: maxUses,
    });
    if (error) {
      // 42501 = 서버가 판정한 권한 부족. 화면 판정과 어긋나면 «서버가» 이긴다.
      return fail(error.code === "42501"
        ? "이 회사에 사람을 부를 수 있는 건 대표와 관리자예요."
        : "링크를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }
    const token = (data as { token?: unknown } | null)?.token;
    if (!isInviteToken(token)) return fail("링크를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");

    revalidatePath("/settings/members");
    return { kind: "created", token };
  } catch {
    return fail("링크를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }
}

export async function revokeInviteLinkAction(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const ctx = await getSession();
  if (!isManager(ctx.role)) return fail("이 회사의 초대 링크를 끌 수 있는 건 대표와 관리자예요.");

  const token = formData.get("token");
  if (!isInviteToken(token)) return fail("어떤 링크인지 알 수 없어요. 새로고침한 뒤 다시 눌러 주세요.");

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_org_invite_link", { p_org_id: ctx.org.id, p_token: token });
    if (error) return fail("링크를 끄지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    revalidatePath("/settings/members");
    return { kind: "revoked" };
  } catch {
    return fail("링크를 끄지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }
}
