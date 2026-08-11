import { SEOUL_STRUCTURE_PACK, allSectionPresets } from "@/lib/structure-packs";

/**
 * 프리셋 라이브러리 (BBE-142 · D03) — 목업 「탭 6개」의 여섯 번째, 지금까지 대응 주소가
 * 없던 탭. 이 화면은 «틀»만 세운다 — 아이템 프리셋(구조) 실데이터를 읽기 전용으로 보여준다.
 *
 * 뷰 프리셋(보기)은 저장된 뷰 시스템(BBE-117)이 아직 이 프리셋 라이브러리와 연결돼 있지
 * 않아 이 화면 범위 밖이다 — 지어내지 않고 명시적으로 "아직 없음"으로 남긴다.
 *
 * 담당범위(scope) 적용 대상이 아니다 — 프리셋은 회사 공용 카탈로그(structure_packs)이지
 * 고객 데이터가 아니다. 그래서 세션 조회 없이 정적 팩 정의를 그대로 읽는다.
 */
export default function PresetsPage() {
  const sections = allSectionPresets();
  const boards = SEOUL_STRUCTURE_PACK.boards;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">프리셋 라이브러리</h1>
          <p className="text-sm text-zinc-500">
            아이템 프리셋(구조) · 뷰 프리셋(보기)
          </p>
        </div>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          아이템 프리셋 {sections.length}
        </span>
      </header>

      <section aria-labelledby="item-presets-heading" className="flex flex-col gap-4">
        <h2 id="item-presets-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          아이템 프리셋 — 구조
        </h2>
        <p className="text-xs text-zinc-500">
          같은 그릇을 여러 회사가 함께 쓴다. 편집은 관리자 권한이다(권한 매트릭스 — BBE-122
          <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">structure.preset_edit</code>).
          이 화면은 아직 읽기 전용이다.
        </p>

        {boards.map((board) => (
          <div key={board.slug} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{board.name}</h3>
              <span className="text-xs text-zinc-500">{board.sections.length}개</span>
            </div>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {board.sections.map((section) => (
                <li
                  key={section.name}
                  className="rounded-full px-2.5 py-1 text-xs text-zinc-700 dark:text-zinc-200"
                  style={{ backgroundColor: `${section.color}1a`, border: `1px solid ${section.color}55` }}
                >
                  {section.groupName || section.name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section aria-labelledby="view-presets-heading" className="flex flex-col gap-2">
        <h2 id="view-presets-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          뷰 프리셋 — 보기
        </h2>
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <p className="text-sm font-medium">뷰 프리셋 연결은 아직 없어요</p>
          <p className="mt-1 text-sm text-zinc-500">
            저장된 뷰는 각 화면에서 만들 수 있지만, 이 라이브러리로는 아직 모이지 않아요.
          </p>
        </div>
      </section>
    </div>
  );
}
