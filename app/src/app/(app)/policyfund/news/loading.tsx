export default function PolicyNewsLoading() {
  return <section aria-busy="true" aria-label="정책자금뉴스 불러오는 중" className="min-h-[360px]">
    <h1 className="border-b border-mw-line pb-2 text-base font-semibold">정책자금뉴스</h1>
    <div className="mt-3 h-[60vh] animate-pulse rounded bg-mw-bg motion-reduce:animate-none" />
  </section>;
}
