import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { repairContactBoardOnEntry } from "@/lib/contact/entry";
import { repairNewcustBoardOnEntry } from "@/lib/newcust/entry";
import { repairNoticeBoardOnEntry } from "@/lib/notices/entry";
import { repairContractWorkBoardOnEntry } from "@/lib/work/entry";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE, NOTICE_TAB_SOURCE } from "./types";
import { CONTRACT_WORK_TAB_SOURCE } from "./contract-work";

const REPAIRS: Readonly<Record<string, (ctx: Ctx, client: SupabaseClient) => Promise<unknown>>> = {
  [NEW_LEAD_TAB_SOURCE]: repairNewcustBoardOnEntry,
  [CONTACT_TAB_SOURCE]: repairContactBoardOnEntry,
  [CONTRACT_WORK_TAB_SOURCE]: repairContractWorkBoardOnEntry,
  [NOTICE_TAB_SOURCE]: repairNoticeBoardOnEntry,
};

const REPAIR_INTERVAL_MS = 10 * 60 * 1000;
const lastRepairAt = new Map<string, number>();

/**
 * Issue 857 — 사이드바가 기본 탭 보드로 바로 가면 경유지의 «진입 점검·복구» 를 안 거친다.
 * 그 점검을 탭 화면이 응답을 보낸 «뒤에» 돌린다(회사·탭마다 10분에 한 번, 대표·관리자만).
 * 경유지와 같은 함수·같은 «늘 새로 읽는» 클라이언트를 쓴다(2026-10-06 중복 생성 사고).
 */
export async function scheduleDefaultTabRepair(ctx: Ctx, source: string | null | undefined): Promise<void> {
  if (ctx.role !== "owner" && ctx.role !== "admin") return;
  const repair = source ? REPAIRS[source] : undefined;
  if (!repair) return;
  const key = `${ctx.org.id}:${source}`;
  const now = Date.now();
  if (now - (lastRepairAt.get(key) ?? 0) < REPAIR_INTERVAL_MS) return;
  lastRepairAt.set(key, now);
  let client: SupabaseClient;
  try {
    client = await createClient({ noStore: true });
  } catch {
    lastRepairAt.delete(key);
    return;
  }
  try {
    after(async () => {
      try {
        await repair(ctx, client);
      } catch {
        // 다음 주기나 경유지 진입에서 다시 점검한다.
      }
    });
  } catch {
    // 요청 밖(시험 등)에서는 미룰 곳이 없다 — 이번엔 건너뛴다.
    lastRepairAt.delete(key);
  }
}
