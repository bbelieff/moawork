import { SEOUL_STRUCTURE_PACK } from "@/lib/structure-packs";
import { APP_TABS } from "@/components/shell/app-tabs";

/**
 * 프리셋 라이브러리 (BBE-142 · D03) — 목업 「탭 6개」의 여섯 번째, 지금까지 대응 주소가
 * 없던 탭. 이 화면은 «틀»만 세운다.
 *
 * ⚠ 1단 자체검수(무유도 서브에이전트)가 초판을 FAIL 시켰다 — 정당한 지적이었다: 초판은
 * `allSectionPresets()`(=설치된 보드의 아이템 그룹, D02)를 그대로 나열해서 숫자(32)만
 * 목업과 우연히 맞았을 뿐, D03이 정의하는 «재사용 가능한 구조 템플릿»(이름·출처 보드·
 * 컬럼 수·공식/내 프리셋 배지가 있는 카드) 개념과 달랐다. 목업 원문(`docs/design/
 * UI목업_워크스페이스_최종_v6.html:1115`)의 카드 형식 `[아이콘,이름,출처보드,"N컬럼",배지]`
 * 를 그대로 실측해 옮겼다 — 출처 보드 컬럼 수·"공식" 배지(이 팩은 전부 회사 공용 시드라
 * 전부 공식)까지 실데이터로 채운다. 그래도 «적용/CSV 내보내기» 등 조작은 아직 없다
 * (편집·적용 기능은 이 카드 범위 밖 — NG-05가 후속 카드로 쪼갠다).
 *
 * 뷰 프리셋(보기)은 저장된 뷰 시스템(BBE-117)이 아직 이 프리셋 라이브러리와 연결돼 있지
 * 않아 이 화면 범위 밖이다 — 지어내지 않고 명시적으로 "아직 없음"으로 남긴다.
 *
 * 담당범위(scope) 적용 대상이 아니다 — 프리셋은 회사 공용 카탈로그(structure_packs)이지
 * 고객 데이터가 아니다. 그래서 세션 조회 없이 정적 팩 정의를 그대로 읽는다.
 */

/** 이관 매핑(BBE-154 A′ — 먼데이 복제분) board.slug → app-tabs.ts 의 탭 key. 목업 표기 라벨을 그대로 쓰기 위한 다리. */
const BOARD_SLUG_TO_TAB_KEY: Record<string, string> = {
  newcust: "new",
  contact: "contact",
  work: "work",
};

function originBoardLabel(slug: string): string {
  const tabKey = BOARD_SLUG_TO_TAB_KEY[slug];
  return APP_TABS.find((tab) => tab.key === tabKey)?.mockupLabel ?? slug;
}

export default function PresetsPage() {
  const boards = SEOUL_STRUCTURE_PACK.boards;
  const totalPresets = boards.reduce((sum, board) => sum + board.sections.length, 0);

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
          아이템 프리셋 {totalPresets}
        </span>
      </header>

      <section aria-labelledby="item-presets-heading" className="flex flex-col gap-3">
        <h2 id="item-presets-heading" className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          아이템 프리셋 — 구조
        </h2>
        <p className="text-xs text-zinc-500">
          같은 그릇을 여러 회사가 함께 쓴다. 편집은 관리자 권한이다(권한 매트릭스 — BBE-122
          <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">structure.preset_edit</code>).
          이 화면은 아직 읽기 전용이다 — 적용·복제는 범위 밖.
        </p>

        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {boards.flatMap((board) =>
            board.sections.map((section) => (
              <li
                key={section.name}
                data-preset-name={section.name}
                className="flex items-start gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <span aria-hidden="true" className="text-base leading-none">
                  {/^\p{Extended_Pictographic}/u.exec(section.groupName)?.[0] ?? "🗂️"}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{section.groupName || section.name}</div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {originBoardLabel(board.slug)} · {board.columns.length}컬럼
                  </p>
                  <span className="mt-1 inline-block text-[11px] text-zinc-500">공식</span>
                </div>
              </li>
            )),
          )}
        </ul>
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
