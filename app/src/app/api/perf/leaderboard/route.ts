/**
 * /api/perf/leaderboard — 담당자별 실적 리더보드(GET).
 *
 * 쿼리: `?period=YYYY-MM&sort=fee|exec|deals`. 기본은 KST 현재월 · 수수료합 정렬.
 * 스냅샷 캐시가 아니라 **원본에서 매 요청 파생**한다(이중저장 금지) — 이번 달 진행 중
 * 숫자를 보려면 이쪽이다.
 */

import { jsonOk, requireCtx, toErrorResponse } from "@/lib/crm";
import { getLeaderboard } from "@/lib/perf";
import { parsePeriod, parseSort } from "@/lib/perf/input";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    const params = new URL(req.url).searchParams;
    const period = parsePeriod(params.get("period"));
    const sort = parseSort(params.get("sort"));
    return jsonOk(getLeaderboard(ctx, { period, sort }));
  } catch (err) {
    return toErrorResponse(err);
  }
}
