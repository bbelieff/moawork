/**
 * 야간 배치 엔드포인트 — 하루치 플랫폼 지표를 집계해 `platform_metrics_daily` 에 적재.
 * (C4 · T04)
 *
 * 호출: Vercel Cron 이 매일 KST 04:00 에 GET 한다.
 *   설정 위치는 `app/vercel.json` — Vercel Root Directory 가 `app` 이라 저장소 루트의
 *   vercel.json 은 읽히지 않는다. schedule 은 UTC 이므로 `0 19 * * *` = KST 익일 04:00.
 *   (vercel.json 스키마는 추가 속성을 거부하므로 설명 주석을 그 파일에 둘 수 없다.)
 *   야간 배치는 '완료된 하루'(KST 어제)를 집계하므로 자정 이후에 돈다.
 * 인증: `CRON_SECRET` 이 설정돼 있으면 `Authorization: Bearer <secret>` 를 요구한다.
 *       미설정이면 **거부**한다 — 인증 없이 전 조직 데이터를 훑는 경로를 열어 두지 않는다.
 *
 * 재실행 안전: 적재는 멱등 upsert(009) 이므로 같은 날짜를 여러 번 돌려도 중복되지 않는다.
 * `?day=YYYY-MM-DD` 로 과거 날짜 재집계가 가능하다(백필).
 */

import { runDailyRollup } from "@/lib/metrics/batch";
import {
  SupabaseMetricsSink,
  SupabaseMetricsSource,
  createBatchClient,
  hasBatchEnv,
} from "@/lib/metrics/batch-supabase";

// 배치는 매번 새로 계산한다 — 캐시 금지.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

/**
 * 고정시간 비교 — 시크릿 비교에서 조기 반환 타이밍 차이를 없앤다.
 * (길이가 다르면 즉시 false 지만, 길이 자체는 비밀이 아니다.)
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorize(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // 열린 채로 두지 않는다. 설정 누락은 명시적 실패.
    return { ok: false, status: 503, error: "CRON_SECRET 미설정 — 배치 엔드포인트가 비활성입니다" };
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !timingSafeEqual(token, secret)) {
    return { ok: false, status: 401, error: "인증 실패" };
  }
  return { ok: true };
}

export async function GET(req: Request): Promise<Response> {
  const auth = authorize(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  if (!hasBatchEnv()) {
    return json(
      { error: "Supabase 배치 환경변수 미설정 (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" },
      501,
    );
  }

  const dayParam = new URL(req.url).searchParams.get("day") ?? undefined;

  try {
    const db = createBatchClient();
    const result = await runDailyRollup(
      new SupabaseMetricsSource(db),
      new SupabaseMetricsSink(db),
      { day: dayParam },
    );

    // 부분 실패를 200 으로 감추지 않는다 — 일부라도 실패하면 207 로 알린다.
    const status = result.failures.length > 0 ? 207 : 200;
    return json(
      {
        day: result.day,
        orgsProcessed: result.rows.length,
        failures: result.failures,
      },
      status,
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "배치 실행 실패" }, 500);
  }
}
