// T09 · 정산 수식 화면 (B4).
//
// 서버 컴포넌트: 002_seed 번들 프리셋에서 진행상품(59)·진행기관(18) 카테고리를
// 로드해 폼에 주입한다. 파생값(수수료·총매출·D+180/365)은 폼이 서버 응답을
// 그대로 표시한다 — 화면 재계산 없음(수용기준).

import { getBundledPresets } from "@/lib/policyfund/bundled";
import { loadOptionCategory } from "@/lib/policyfund";
import { SettlementForm } from "@/components/policyfund/SettlementForm";

export const metadata = {
  title: "정산 계산 — 모아워크",
};

export default function SettlementsPage() {
  const presets = getBundledPresets();
  const productCategory = loadOptionCategory(presets, "product");
  const agencyCategory = loadOptionCategory(presets, "agency");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">정산 계산</h1>
        <p className="text-sm text-zinc-500">
          실행액·수수료율 입력 → 수수료 · 총매출 · D+180 · D+365 산출.
          진행상품 {productCategory.options.length}종 · 진행기관{" "}
          {agencyCategory.options.length}종 (002_seed 프리셋)
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-500">
          파생값은 DB generated column 산출값입니다 — 화면에서 재계산하지 않습니다.
        </p>
      </header>

      <SettlementForm
        productCategory={productCategory}
        agencyCategory={agencyCategory}
      />
    </main>
  );
}
