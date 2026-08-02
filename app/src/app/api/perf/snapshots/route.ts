/**
 * /api/perf/snapshots — 저장된 월 성과 스냅샷 조회(GET, ?period=YYYY-MM).
 *
 * 리더보드(/api/perf/leaderboard)가 원본에서 매번 파생하는 값이라면, 여기는
 * **월 마감으로 확정된 캐시**다. 지급 대상 숫자는 이쪽을 본다.
 */

import { jsonOk, requireCtx, toErrorResponse } from "@/lib/crm";
import { listSnapshots } from "@/lib/perf";
import { parsePeriod } from "@/lib/perf/input";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const period = parsePeriod(new URL(req.url).searchParams.get("period"));
    return jsonOk({ period: period ?? null, items: listSnapshots(ctx, { period }) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
