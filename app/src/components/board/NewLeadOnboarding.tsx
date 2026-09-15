export function NewLeadOnboarding() {
  return (
    <span className="group/help relative inline-flex shrink-0">
      <button
        type="button"
        aria-label="신규리드 도움말"
        aria-describedby="new-lead-help-note"
        className="grid size-5 place-items-center rounded-full border border-mw-line bg-mw-card text-[11px] font-bold text-mw-sub outline-none transition-colors hover:border-mw-record hover:text-mw-record focus-visible:ring-2 focus-visible:ring-mw-record"
      >
        ?
      </button>
      <span
        id="new-lead-help-note"
        role="tooltip"
        className="mw-layer-tooltip invisible absolute left-0 top-full mt-2 w-72 rounded-md border border-mw-line bg-mw-card p-3 text-left shadow-xl opacity-0 transition-opacity group-hover/help:visible group-hover/help:opacity-100 group-focus-within/help:visible group-focus-within/help:opacity-100"
      >
        <strong className="block text-sm text-mw-fg">신규리드 시작하기</strong>
        <span className="mt-1 block text-xs leading-5 text-mw-body">
          새 회사에서 기본 정보를 등록하고 표에서 상담 상황과 담당자를 바로 고칠 수 있어요.
          상담이 준비되면 표 맨 오른쪽에 고정된 ‘진행현황’에서 다음 탭으로 넘기세요.
        </span>
      </span>
    </span>
  );
}
