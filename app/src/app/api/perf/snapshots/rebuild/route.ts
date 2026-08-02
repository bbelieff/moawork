/**
 * /api/perf/snapshots/rebuild — 월 성과 스냅샷 재계산(POST).
 *
 * 설계 §2.4 의 트리거 (a) "이번 달 재계산" 버튼과 (b) 월 마감 배치가 **같은 경로**를 쓴다.
 * 두 벌로 구현하면 버튼과 배치의 숫자가 갈린다.
 *
 * 본문: `{ period?: "YYYY-MM" }` — 생략 시 KST 현재월.
 * 권한: 조직 전체를 조회할 수 있는 호출자만(owner/admin 또는 scope=all) → 아니면 403.
 *       근거는 service.ts 의 requireOrgWideReader 주석 참고(부분집합 덮어쓰기 방지).
 */

import { jsonOk, readJson, requireCtx, toErrorResponse } from "@/lib/crm";
import { parseRebuild } from "@/lib/perf/input";
import { recomputeSnapshots } from "@/lib/perf";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireCtx();
    // 본문 없는 POST(현재월 재계산)를 허용하되, 본문이 **있는데** 깨졌으면 400 이다.
    // 무조건 readJson 하면 빈 본문이 파싱 오류가 되고, 오류를 삼키면 오타난 period 가
    // 조용히 무시돼 엉뚱한 달이 재계산된다.
    const hasBody = (req.headers.get("content-length") ?? "0") !== "0";
    const { period } = parseRebuild(hasBody ? await readJson(req) : null);
    const result = recomputeSnapshots(ctx, { period });
    return jsonOk({
      period: result.period,
      rowCount: result.rowCount,
      ruleName: result.ruleName,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
