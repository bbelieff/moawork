import "dotenv/config";
import PgBoss from "pg-boss";
import { health } from "./health.js";

/**
 * moawork 워커 엔트리포인트 (골격).
 * pg-boss 잡 큐를 부트스트랩한다. 실제 잡 핸들러 등록은 후속 트랙에서 추가한다.
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

  // TODO(후속 트랙): boss.work("<queue>", handler) 로 잡 핸들러 등록
}

main().catch((err: unknown) => {
  console.error("[worker] fatal", err);
  process.exitCode = 1;
});
