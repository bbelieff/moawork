// T07 · /platform 진입 가드(서버 전용).
//
// 비관리자는 메뉴가 안 보이는 것으로 끝나지 않는다 — **직접 URL 접근도 차단**한다.
// 판정은 008 `platform_admin_level()` SECURITY DEFINER 경유이며,
// 같은 판정이 RPC 안에서도 강제되므로 이 가드를 우회해도 데이터는 나오지 않는다(이중 방어).

import { redirect } from "next/navigation";
import { loadAdminLevel, platformClient, touchLastSeen } from "./server";
import type { AdminLevel } from "./types";

/**
 * 콘솔 진입 가드. 관리자가 아니면 리다이렉트하고 반환하지 않는다.
 *
 * 리다이렉트 대상은 워크스페이스 입구다 — 로그인 페이지로 보내면
 * "로그인하면 볼 수 있다"는 잘못된 신호를 준다. 존재 자체를 알리지 않는다.
 */
export async function requirePlatformAdmin(): Promise<AdminLevel> {
  const level = await loadAdminLevel();
  if (!level) redirect("/workspace-entry?error=permission");

  // 접속 흔적(감사). 실패해도 진입은 막지 않는다.
  await touchLastSeen(await platformClient());
  return level;
}
