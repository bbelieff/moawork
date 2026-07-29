/**
 * /platform/지원 — 운영자 지원 콘솔 (T08).
 *
 * 문의 목록 · 스레드 뷰 · [위임 요청 보내기] · 위임 상태 표시.
 *
 * ⚠ `/platform` 셸은 다른 세션(T07)이 만든다. 여기서는 **라우트와 내용만** 두고
 *   셸이 생기면 그쪽이 감싸도록 한다(타 트랙 화면 침범 금지).
 *   그래서 기존 `/platform/workspace-requests` 와 같은 방식으로 자체 <main> 만 그린다.
 */

import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { getSupportService } from "@/lib/support";
import { OperatorSupportConsole } from "@/components/support/OperatorSupportConsole";

export default async function PlatformSupportPage() {
  const ctx = await getSessionOrNull();
  if (!ctx) redirect("/login?next=/platform/%EC%A7%80%EC%9B%90");
  if (!ctx.isPlatformAdmin) redirect("/workspace-entry?error=permission");

  const service = getSupportService();
  const threads = service.listOperatorThreads(ctx);
  const detail = threads[0] ? service.getThread(ctx, threads[0].id) : null;

  return (
    <main style={{ padding: "24px 20px", maxWidth: 1080, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>지원</h1>
      <p style={{ fontSize: 13, color: "var(--mw-sub)", marginBottom: 18 }}>
        고객 문의와 접근 위임 상태를 확인합니다. 위임은 고객이 직접 열어주는 것이
        기본이며, 여기서는 요청만 보낼 수 있습니다.
      </p>
      <OperatorSupportConsole threads={threads} initialDetail={detail} />
    </main>
  );
}
