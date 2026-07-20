// T09 · 정책자금 보드 화면 (먼데이 "업무관리" 31컬럼 재현) + 선택지 카탈로그.
//
// 서버 컴포넌트: 번들 프리셋 스냅샷(002_seed 추출)에서 컬럼·선택지를 로드해
// 클라이언트 표현 컴포넌트에 전달. 프로덕션은 DB industry_modules 로드로 대체.

import { getBundledPresets } from "@/lib/policyfund/bundled";
import {
  loadOptionCategories,
  getWorkBoardColumns,
  CATEGORY_IDS,
  type OptionCategoryId,
} from "@/lib/policyfund";
import { PolicyfundBoard } from "@/components/policyfund/PolicyfundBoard";
import { OptionSelect } from "@/components/policyfund/OptionSelect";

export const metadata = {
  title: "정책자금 보드 — 모아워크",
};

export default function PolicyfundBoardPage() {
  const presets = getBundledPresets();
  const columns = getWorkBoardColumns(presets);
  const categories = loadOptionCategories(presets);
  // 단계 필터/정렬 기준: "진행상항"(14단계).
  const stageOrder = categories.progress_status.options.map((o) => o.label);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">정책자금 보드</h1>
        <p className="text-sm text-zinc-500">
          먼데이 &ldquo;업무관리&rdquo; 보드 재현 · {columns.length}컬럼 ·
          프리셋 {CATEGORY_IDS.length}종
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-500">
          미리보기: 컬럼·선택지는 002_seed 스냅샷. 아이템(행) 데이터는 DB 연동
          후 표시됩니다.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">업무관리 보드</h2>
        <PolicyfundBoard
          columns={columns}
          items={[]}
          stageColumn="진행상항"
          stageOrder={stageOrder}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">선택지 카탈로그</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORY_IDS.map((id: OptionCategoryId) => (
            <OptionSelect key={id} category={categories[id]} />
          ))}
        </div>
      </section>
    </main>
  );
}
