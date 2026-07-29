/**
 * 지원 위젯 마운트 지점 — T08 (서버 컴포넌트).
 *
 * 앱 셸에 한 번만 붙여 (a) 위임 중 고정 배너, (b) 우측 하단 플로팅 버튼을 그린다.
 * 서버에서 활성 위임과 뱃지 숫자를 계산해 내려보내므로 첫 페인트부터 정확하다.
 *
 * `activeGrant()` 호출은 만료된 위임을 정리하면서 만료 기록(소식창·감사로그·오너 알림)을
 * 남긴다 — 별도 스케줄러 없이 화면 진입만으로 수명주기가 닫힌다.
 */

import type { Ctx } from "@/lib/types";
import { getSupportService } from "@/lib/support";
import { AccessGrantBanner } from "./AccessGrantBanner";
import { SupportLauncher } from "./SupportLauncher";

/** 문의에 함께 붙는 앱 버전(진단용). 배포 커밋이 있으면 그것을 쓴다. */
function appVersion(): string {
  return (
    process.env.NEXT_PUBLIC_APP_VERSION ??
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    "dev"
  );
}

export function SupportBanner({ ctx }: { ctx: Ctx }) {
  const grant = getSupportService().activeGrant(ctx);
  if (!grant) return null;
  return <AccessGrantBanner grant={grant} />;
}

export function SupportWidget({ ctx }: { ctx: Ctx }) {
  const service = getSupportService();
  return (
    <SupportLauncher
      role={ctx.role}
      // Org 타입(T03 소유)에 아직 slug 가 없다 — 워크스페이스 식별자로 org.id 를 보낸다.
      orgSlug={ctx.org.id}
      appVersion={appVersion()}
      initialUnread={service.unreadCount(ctx)}
      activeGrant={service.activeGrant(ctx)}
    />
  );
}
