// T07 · /platform/access — 접근 기록.
//
// `access_grants` / `access_events` 는 **지원 위젯/위임 작업 트랙이 만든다**.
// 그 테이블이 아직 없으므로 여기서는 자리만 잡고 "준비 중"으로 둔다.
// ⚠ 이 화면이 테이블을 만들지 않는다(소유 트랙 침범 금지).

import {
  ComingSoon,
  Panel,
  PlatformShell,
} from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";

export const dynamic = "force-dynamic";

export default async function PlatformAccessPage() {
  const level = await requirePlatformAdmin();

  return (
    <PlatformShell
      level={level}
      pathname="/platform/access"
      title="접근 기록"
      description="운영자가 고객 데이터에 접근한 이력을 남기는 화면입니다."
    >
      <Panel title="열람 승인(access_grants)">
        <ComingSoon>
          승인 이력 테이블이 아직 없습니다. 지원·위임 트랙이 access_grants 를 만들면
          이 자리에 표시됩니다. (준비 중)
        </ComingSoon>
      </Panel>

      <Panel title="접근 이벤트(access_events)">
        <ComingSoon>
          접근 이벤트 테이블이 아직 없습니다. (준비 중)
        </ComingSoon>
      </Panel>

      <Panel title="현재 정책">
        <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.875rem" }}>
          <li>P0에서 플랫폼 운영자는 고객 업무 데이터를 조회하지 않습니다.</li>
          <li>홈택스 연동 데이터는 등급과 무관하게 항상 차단됩니다.</li>
          <li>
            break-glass(승인 후 실제 열람)는 다음 단계 범위이며 아직 구현되지 않았습니다.
          </li>
        </ul>
      </Panel>
    </PlatformShell>
  );
}
