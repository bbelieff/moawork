import "server-only";

import { cookies } from "next/headers";
import { getSessionOrNull } from "@/lib/auth/session";
import { loadPlatformActor, type PlatformActor } from "@/lib/platform/actor";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import {
  modePreferenceCookie,
  readModePreference,
} from "@/lib/mode/preference";
import type { Ctx } from "@/lib/types";
import type { SupporterMode } from "./contracts";

/**
 * 서포터 접근 판정 입력. 모두 서버가 검증한 값만 받는다.
 * 서명된 표시 모드(mw_mode)는 권한을 대신하지 않는다 — 운영 모드 요청이
 * 실제 운영 화면에서 왔는지의 보조 확인으로만 쓴다.
 *
 * 모드별로 쓰는 입력이 다르다:
 * - user: 활성 회사 세션이 권한의 전부다. actor/displayMode 는 보지 않는다.
 * - operations: 회사 세션을 요구하지 않는다. 플랫폼 승인(actor) + 서명된
 *   플랫폼 표시가 권한의 전부이므로, 회사 멤버십이 없는 플랫폼 전담자도
 *   쓸 수 있다. session 자리는 user 모드와 타입을 맞추기 위한 자리다.
 */
export type SupporterAccessDeps = {
  /** 활성 회사 세션. user 모드에서만 본다. */
  session: Ctx | null;
  /** 현재 로그인 기준 플랫폼 판정. 고객 회사 owner 여부는 운영 권한이 아니다. */
  actor: PlatformActor;
  /** 서명 검증된 표시 모드. null = 없음·위조·미설정. */
  displayMode: "platform" | "user" | null;
};

export type SupporterAccessDecision =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "operations_forbidden" | "status_unavailable";
    };

export function decideSupporterAccess(
  mode: SupporterMode,
  deps: SupporterAccessDeps,
): SupporterAccessDecision {
  if (mode === "user") {
    if (!deps.session) return { ok: false, error: "unauthenticated" };
    return { ok: true };
  }
  // operations 는 회사 세션을 보지 않는다 — 여기서 getSessionOrNull 을
  // 부르면 설정 부재가 401 로 위장될 뿐 아니라 회사 멤버십 없는
  // 플랫폼 전담자가 막힌다.
  if (deps.actor.kind === "unavailable") {
    return { ok: false, error: "status_unavailable" };
  }
  if (deps.actor.kind === "denied") {
    return deps.actor.reason === "unauthenticated"
      ? { ok: false, error: "unauthenticated" }
      : { ok: false, error: "operations_forbidden" };
  }
  if (deps.displayMode !== "platform") {
    return { ok: false, error: "operations_forbidden" };
  }
  return { ok: true };
}

/**
 * 현재 요청의 서포터 접근을 판정한다. 예외(인증 백엔드 장애 등)는
 * 호출자가 503 으로 처리할 수 있도록 그대로 던진다.
 */
export async function loadSupporterAccess(
  mode: SupporterMode,
): Promise<SupporterAccessDecision> {
  const jar = await cookies();
  const displayMode = readModePreference(jar.get(modePreferenceCookie.name)?.value);
  if (mode === "operations") {
    const actor = await loadPlatformActor();
    return decideSupporterAccess(mode, { session: null, actor, displayMode });
  }
  // 운영에서 백엔드 설정이 통째로 없으면 세션 조회를 시도하지 않는다.
  // getSessionOrNull 은 null 만 돌려줘서 설정 부재가 미인증(401)으로 위장된다.
  if (process.env.NODE_ENV === "production" && !hasSupabaseEnv()) {
    return { ok: false, error: "status_unavailable" };
  }
  const session = await getSessionOrNull();
  return decideSupporterAccess(mode, {
    session,
    actor: { kind: "denied" as const, reason: "not_platform" as const },
    displayMode,
  });
}
