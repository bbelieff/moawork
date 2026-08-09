// 잠금 안내 한 조각 — 클라이언트 게이트(FeatureGate)와 서버 게이트(FeatureGateServer)가
// 같은 문구·같은 모양을 쓰도록 여기 한 곳에만 둔다.
//
// ⚠ 이 안내는 **화면 전체가 아니라 잠긴 영역에만** 그려져야 한다. 페이지 본문 전체를
//    게이트로 감싸면 잠금 시 화면이 이 한 줄로 붕괴한다(P0 · 신규 회사 첫 진입 사고).
export function FeatureLockNotice({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/40">
      🔒 {label} — 현재 플랜에서 잠긴 기능입니다{" "}
      <span className="text-zinc-400">(Phase 2)</span>
    </div>
  );
}
