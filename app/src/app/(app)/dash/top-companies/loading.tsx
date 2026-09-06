export default function Loading() {
  return <div role="status" aria-live="polite" aria-busy="true" className="space-y-4"><span className="sr-only">계약회사 현황을 불러오는 중입니다</span><div className="h-16 animate-pulse rounded bg-[var(--mw-s-2)]" /><div className="h-72 animate-pulse rounded bg-[var(--mw-s-2)]" /></div>;
}
