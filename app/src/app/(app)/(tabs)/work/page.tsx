import { redirect } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { repairContractWorkBoardOnEntry } from "@/lib/work/entry";
import { createClient } from "@/lib/supabase/server";

/**
 * 계약업체 실무 기본 탭의 제품 진입점 — 리드컨택(`/contract`)과 «같은 형태» 다.
 * 보드를 additive 로 복구한 뒤 표준 보드 화면(`/boards/<id>`)으로 넘긴다.
 *
 * ★ 과거 결정(BBE-31)을 뒤집는다 — 근거를 여기 남긴다.
 *   전에는 이 주소가 work-management 읽기 모델(표/캘린더/간트)로 «따로» 그렸고,
 *   주석에 「/work 는 설치 후 work-management 상호작용 계약을 우회하면 안 된다」고 적혀 있었다.
 *
 *   그런데 실측하니 그 렌더러가 이 보드와 맞지 않는다 (2026-08-25 운영, #551):
 *     · 그 화면은 `태스크`(items.title) 컬럼을 전제하는데 보드에는 그 컬럼이 «없다»
 *       → 표에 업무 이름이 아예 안 나온다. 무엇이 무엇인지 알 수 없는 표가 된다.
 *     · 목업(계약업체 실무)에도 「태스크」 열은 없다 — 첫 열은 «진행기관» 이다.
 *       즉 없는 것이 정상이고, 그 전제를 가진 렌더러가 이 보드에 안 맞는 것이다.
 *     · 나머지 세 탭(신규리드·리드컨택·공지사항)은 이미 표준 보드 화면을 쓴다.
 *       계약업체 실무만 혼자 다른 화면이었다.
 *
 *   잃는 것: 간트 보기. 목업에 간트는 없고, 표준 화면은 표·칸반·캘린더를 갖고 있다.
 *   얻는 것: 목업의 28컬럼·그룹·이동규칙이 그대로 그려지고, 네 탭이 같은 조작을 갖는다.
 */
export default async function ContractWorkBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string; notification?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const result = await repairContractWorkBoardOnEntry(ctx, await createClient());
  if (result.kind !== "ready") {
    const conflict = result.kind === "conflict";
    const permission = result.kind === "permission";
    return (
      <section className="rounded-xl border border-mw-line bg-mw-card p-5" aria-labelledby="work-entry-title">
        <h1 id="work-entry-title" className="text-lg font-semibold text-mw-fg">
          {conflict
            ? "계약업체 실무 보드를 하나로 확인하지 못했습니다"
            : permission
              ? "계약업체 실무 보드 복구 권한이 없습니다"
              : "계약업체 실무 보드를 찾을 수 없습니다"}
        </h1>
        <p className="mt-2 text-sm text-mw-sub">
          {conflict
            ? "회사 관리자에게 보드 구성을 확인해 달라고 요청해 주세요."
            : permission
              ? "활성 owner 또는 admin에게 이 워크스페이스의 기본 보드 복구를 요청해 주세요."
              : "회사 관리자에게 문의해 주세요 — 새 워크스페이스에는 이 보드가 자동으로 있어야 합니다."}
        </p>
      </section>
    );
  }

  // 알림에서 들어온 경우 하이라이트 대상을 표준 화면으로 넘긴다.
  const params = new URLSearchParams();
  if (sp.as) params.set("as", sp.as);
  if (sp.notification) params.set("mwFocus", sp.notification);
  const query = params.size > 0 ? `?${params.toString()}` : "";

  redirect(`/boards/${encodeURIComponent(result.boardId)}${query}`);
}
