"use client";

export default function MembersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="mx-auto max-w-3xl rounded-md border border-zinc-200 p-5 dark:border-zinc-800"><p className="text-sm text-zinc-600 dark:text-zinc-300">회사와 팀 화면을 열지 못했어요.</p><button type="button" onClick={reset} className="mt-3 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">다시 시도</button></div>;
}
