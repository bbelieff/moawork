import "dotenv/config";
import PgBoss from "pg-boss";
import { health } from "./health.js";
import { defaultProviders, registerNotifyWorker } from "./notify/index.js";
import { pendingLoader, pendingSink } from "./notify/pending.js";
import {
  pendingRollupRunner,
  registerPlatformMetricsRollup,
} from "./platform/index.js";

/**
 * moawork 워커 엔트리포인트.
 * pg-boss 잡 큐를 부트스트랩하고 잡 핸들러를 등록한다.
 * 비밀값은 환경변수(DATABASE_URL)로만 주입하며 코드/저장소에 기록하지 않는다.
 */
async function main(): Promise<void> {
  console.log("[worker] boot", health());

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn("[worker] DATABASE_URL 미설정 — 큐 연결 생략(골격 모드)");
    return;
  }

  const boss = new PgBoss(connectionString);
  boss.on("error", (err: Error) => console.error("[worker] pg-boss error", err));
  await boss.start();
  console.log("[worker] pg-boss 시작됨");

  // mod.notify — Phase 2 스캐폴드(스텁). 큐/핸들러 배선만 살아 있고 실제 발송은 하지 않는다.
  // 활성화 전제: 벤더 계약(DI-5) → 프로바이더 구현 + Supabase 어댑터로 아래 스텁 교체.
  await registerNotifyWorker(boss, {
    providers: defaultProviders(),
    loader: pendingLoader,
    sink: pendingSink,
  });
  console.log("[worker] notify.send 등록됨 (스텁 — 실제 발송 없음)");

  // T07 플랫폼 지표 — 매일 03:10 KST 롤업. 화면(/platform)은 이 배치가 채운
  // platform_metrics_daily 만 읽는다(요청 시점 실시간 집계 금지).
  // 러너는 스텁이라 아직 0행이다 — 활성화 조건은 platform/rollup.ts 주석 참고.
  await registerPlatformMetricsRollup(boss, { runner: pendingRollupRunner });
  console.log("[worker] platform.metrics.rollup 등록됨 (스텁 — service_role 미주입)");
}

main().catch((err: unknown) => {
  console.error("[worker] fatal", err);
  process.exitCode = 1;
});
