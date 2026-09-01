"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isManager, type MemberRole } from "@/lib/auth/roles";
import {
  parseDutyLines,
  parseRuleLines,
  trimmedText,
  type SeatDefinitionState,
} from "./seat-definition-state";

/**
 * 역할 정의서를 저장한다 (#683 · D안 1단계).
 *
 * ★ 권한 판정은 «서버 함수» 가 한다(마이그레이션 146 의 save_seat_definition).
 *   여기서 다시 규칙을 흉내 내지 않는다 — 두 곳에 같은 규칙을 적으면 반드시 어긋난다.
 *   아래 isManager 는 «화면을 빨리 되돌리기» 위한 앞차단일 뿐이고, 관문은 RPC 다.
 *
 * ★ 이 파일은 async 함수 하나만 내보낸다. 상수·동기 함수는 seat-definition-state.ts 에 있다 —
 *   `"use server"` 파일이 그 밖의 것을 내보내면 Next 가 로더를 평가할 때 통째로 터진다.
 */

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;
const ROLES = new Set<MemberRole>(["owner", "admin", "team_lead", "member"]);

export async function saveSeatDefinitionAction(
  _previous: SeatDefinitionState,
  formData: FormData,
): Promise<SeatDefinitionState> {
  try {
    const ctx = await getSession();
    // 앞차단 — 진짜 관문은 RPC 다.
    if (!isManager(ctx.role)) return { ok: false, message: "역할 정의서는 대표와 관리자만 쓸 수 있어요." };

    const departmentRaw = formData.get("departmentId");
    const departmentId = typeof departmentRaw === "string" && UUID.test(departmentRaw) ? departmentRaw : null;
    const roleRaw = formData.get("role");
    if (typeof roleRaw !== "string" || !ROLES.has(roleRaw as MemberRole)) {
      return { ok: false, message: "어떤 자리인지 확인하지 못했어요. 화면을 새로 고쳐 주세요." };
    }

    const client = await createClient();
    const { error } = await client.rpc("save_seat_definition", {
      p_org_id: ctx.org.id,
      p_department_id: departmentId,
      p_role: roleRaw,
      p_summary: trimmedText(formData.get("summary"), 400),
      p_duties: parseDutyLines(formData.get("duties")),
      p_rules: {
        escalate: parseRuleLines(formData.get("escalate")),
        handle: parseRuleLines(formData.get("handle")),
        avoid: parseRuleLines(formData.get("avoid")),
      },
      p_signals: trimmedText(formData.get("signals"), 400),
      p_handover: trimmedText(formData.get("handover"), 4000),
    });

    if (error) {
      return {
        ok: false,
        message:
          error.code === "42501"
            ? "역할 정의서를 쓸 권한이 없어요."
            : error.code === "22023"
              ? "적은 내용을 저장하지 못했어요. 형식을 확인해 주세요."
              : "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요. 적은 내용은 그대로 두었어요.",
      };
    }

    revalidatePath("/settings/members");
    return { ok: true, message: "역할 정의서를 저장했어요." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "저장하지 못했어요.",
    };
  }
}
