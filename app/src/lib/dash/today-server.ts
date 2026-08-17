// BBE-186 · 홈(V6 «오늘») 이 소비하는 read model 한 겹.
//
// 계약·집계는 BBE-185 가 소유한다(`read_today_dashboard` · `./today.ts`).
// 여기서는 그 계약을 «화면이 그릴 수 있는 상태» 로만 바꾼다 — 숫자를 다시 계산하지 않는다.
//
// 상태가 셋인 이유: 홈은 실패해도 흰 화면이 되면 안 된다(§3).
//   unconfigured  Supabase 환경변수가 없다(로컬 시드 모드). 오류가 아니라 «아직 연결 안 됨» 이다.
//   error         연결은 됐는데 읽지 못했다. 사유를 사람 말로 보여준다.
//   ready         스냅샷을 받았다. 그 안의 status 가 다시 ready/empty/partial 로 갈린다.
// empty·partial 을 여기서 다시 판정하지 않는다 — 서버가 이미 판정해서 준다(today.ts:43).

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readTodayDashboard, type TodayDashboardSnapshot } from "./today";

export type TodayHomeState =
  | { kind: "ready"; snapshot: TodayDashboardSnapshot }
  | { kind: "unconfigured" }
  | { kind: "error"; reason: string };

/**
 * 홈 한 화면이 쓰는 단 하나의 조회.
 *
 * `createClient()` 는 환경변수가 없으면 throw 한다(lib/supabase/env.ts:12). 그것을 잡지 않으면
 * 홈 전체가 500 이 된다 — 실제로 e28925c 기준 로컬 시드 모드에서 그랬다. 가드가 여기 있는 이유다.
 */
export async function loadTodayHome(
  orgId: string,
  options: { asOf?: Date; clientFactory?: typeof createClient } = {},
): Promise<TodayHomeState> {
  if (!hasSupabaseEnv()) return { kind: "unconfigured" };
  try {
    const client = await (options.clientFactory ?? createClient)();
    const snapshot = await readTodayDashboard(client, orgId, options.asOf ?? new Date());
    return { kind: "ready", snapshot };
  } catch (error) {
    // 원문 메시지에는 접속 정보가 섞일 수 있다. 사람이 읽을 한 줄만 남긴다(§9.2).
    return {
      kind: "error",
      reason: error instanceof Error && error.message ? error.message : "알 수 없는 오류",
    };
  }
}
