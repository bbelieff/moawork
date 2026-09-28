"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section role="alert" className="rounded-[var(--mw-r-2)] border border-[var(--mw-bd)] p-8 text-center"><h1 className="font-semibold">계약회사 현황을 불러오지 못했습니다</h1><p className="mt-2 text-sm text-[var(--mw-t-3)]">잠시 후 다시 시도해 주세요.</p><button type="button" onClick={reset} className="mt-5 min-h-11 rounded-[var(--mw-r-1)] bg-[var(--mw-primary)] px-4 text-sm font-medium text-[var(--mw-on-accent)]">다시 시도</button></section>;
}
