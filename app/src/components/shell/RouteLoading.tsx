// 화면 본문이 비는 동안 «로딩 중» 임을 보이게 한다 — BBE-214.
//
// 왜 필요한가: 앱 셸(app/(app)/layout.tsx)은 사이드바·탭 줄을 «즉시» 그리고
// 바뀌는 것은 <main>{children}</main> 뿐이다. 그래서 서버가 데이터를 읽는 동안
// 본문만 통째로 비었고, 사용자는 **깨진 것인지 로딩 중인지 구분할 수 없었다.**
//
// Next 의 `loading.tsx` 규약을 그대로 쓴다(settings/members·settings/account 가 이미 그렇게 한다).
// 새 로딩 장치를 발명하지 않는다 — 각 라우트의 loading.tsx 가 이 부품을 부르기만 한다.
//
// 색·간격·글자 크기는 브랜드 토큰만 참조한다(AGENTS.md §9.3 — 하드코딩 금지).

export function RouteLoading({ label }: { label: string }) {
  return (
    <div
      // role="status" 는 화면을 못 보는 사용자에게도 «지금 기다리는 중» 을 알린다.
      role="status"
      aria-busy="true"
      data-testid="route-loading"
      className="flex animate-pulse items-center"
      style={{
        gap: "var(--sp-2)",
        border: "1px solid var(--mw-line)",
        borderRadius: "var(--mw-r-3)",
        background: "var(--mw-card)",
        padding: "var(--sp-5)",
        fontSize: "var(--fs-13)",
        color: "var(--mw-sub)",
      }}
    >
      {label}
    </div>
  );
}
