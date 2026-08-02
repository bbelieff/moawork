// T07 · /platform/support — 지원 문의.
//
// 지원 위젯은 별도 트랙 소유다. 여기서는 IA 자리만 잡고 준비 중으로 둔다.

import {
  ComingSoon,
  Panel,
  PlatformShell,
} from "@/components/platform/PlatformShell";
import { requirePlatformAdmin } from "@/lib/platform/guard";

export const dynamic = "force-dynamic";

export default async function PlatformSupportPage() {
  const level = await requirePlatformAdmin();

  return (
    <PlatformShell
      level={level}
      pathname="/platform/support"
      title="지원 문의"
      description="고객사가 보낸 문의와 위임 요청을 처리하는 화면입니다."
    >
      <Panel title="문의 목록">
        <ComingSoon>
          지원 위젯 트랙이 문의 저장소를 만들면 이 자리에 표시됩니다. (준비 중)
        </ComingSoon>
      </Panel>
    </PlatformShell>
  );
}
