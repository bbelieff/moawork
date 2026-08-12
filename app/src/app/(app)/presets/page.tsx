/**
 * 제품 프리셋 라이브러리.
 * 서울경영 먼데이 복제분은 이관 매핑 사전이므로 제품 기본 프리셋으로 노출하지 않는다.
 */
export default function PresetsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">프리셋 라이브러리</h1>
          <p className="text-sm text-zinc-500">아이템 프리셋(구조) · 뷰 프리셋(보기)</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          아이템 프리셋 0
        </span>
      </header>

      <section aria-labelledby="item-presets-heading" className="flex flex-col gap-3">
        <h2 id="item-presets-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          아이템 프리셋 · 구조
        </h2>
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <p className="text-sm font-medium">등록된 제품 기본 프리셋이 없습니다</p>
          <p className="mt-1 text-sm text-zinc-500">
            먼데이 원본 구조는 데이터 이관 때만 사용하는 매핑 사전으로 보관됩니다.
          </p>
        </div>
      </section>

      <section aria-labelledby="view-presets-heading" className="flex flex-col gap-2">
        <h2 id="view-presets-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          뷰 프리셋 · 보기
        </h2>
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <p className="text-sm font-medium">뷰 프리셋 연결은 아직 없어요</p>
          <p className="mt-1 text-sm text-zinc-500">
            저장한 뷰는 각 화면에서 만들 수 있지만, 이 라이브러리로는 아직 모이지 않아요.
          </p>
        </div>
      </section>
    </div>
  );
}
