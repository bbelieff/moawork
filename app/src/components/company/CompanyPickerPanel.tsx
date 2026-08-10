"use client";

/**
 * 업체 찾기 패널 (BBE-125).
 *
 * 목업 `openPicker`/`pfilter`(계약업체 실무 → ＋ 새 업체)의 내용을 그대로 옮긴
 * **프레젠테이션 전용** 컴포넌트다. 열고 닫는 다이얼로그 chrome과 실제 데이터 소스 연결은
 * 이 카드 리스 밖(호출자 몫) — 여기서는 검색·목록·선택 결과만 그린다.
 */

import { searchCompanies } from "@/lib/company/match";
import type { CompanyCandidate } from "@/lib/company/types";

export interface CompanyPickerPanelProps {
  companies: readonly CompanyCandidate[];
  query: string;
  onQueryChange: (query: string) => void;
  onPick: (company: CompanyCandidate) => void;
  onCreateNew: (name: string) => void;
}

function summaryLine(c: CompanyCandidate): string {
  const region = [c.regionSido, c.regionSigungu].filter(Boolean).join(" ");
  return [c.ceoName, c.bizType, c.industry, region].filter(Boolean).join(" · ");
}

export function CompanyPickerPanel({
  companies,
  query,
  onQueryChange,
  onPick,
  onCreateNew,
}: CompanyPickerPanelProps) {
  const results = searchCompanies(companies, query);
  const trimmed = query.trim();

  return (
    <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <p className="font-semibold">업체 추가</p>
        <p className="text-xs text-zinc-500">회사명을 먼저 찾습니다</p>
      </div>

      <input
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="회사명 · 초성으로도 찾을 수 있어요  예: ㅇㅈㅅㅇ"
        autoComplete="off"
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-visible:outline-zinc-100"
      />

      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {results.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c)}
              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:hover:bg-zinc-900 dark:focus-visible:outline-zinc-100"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-medium dark:bg-zinc-800">
                {c.name[0]}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{c.name}</span>
                <span className="truncate text-xs text-zinc-500">{summaryLine(c)}</span>
              </span>
              <span className="shrink-0 text-right text-xs text-zinc-500">
                {c.dealCount > 0 ? (
                  <>
                    진행 이력 {c.dealCount}건
                    {c.lastActivity ? <><br />{c.lastActivity}</> : null}
                  </>
                ) : (
                  "이력 없음"
                )}
              </span>
            </button>
          </li>
        ))}
        {results.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-zinc-500">
            «{trimmed}» 로 찾은 업체가 없습니다
          </li>
        ) : null}
      </ul>

      <button
        type="button"
        onClick={() => onCreateNew(trimmed)}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-2 py-2 text-left hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:focus-visible:outline-zinc-100"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
          ＋
        </span>
        <span className="flex flex-col">
          <span className="font-medium">
            {trimmed ? `«${trimmed}» 새 업체로 등록` : "새 업체로 등록"}
          </span>
          <span className="text-xs text-zinc-500">찾는 업체가 없을 때만 — 중복 등록에 주의하세요</span>
        </span>
      </button>

      <p className="text-[11px] text-zinc-500">
        이미 있는 업체를 고르면 <b>저장된 정보가 그대로 채워집니다</b> — 같은 회사를 두 번 적지 않게
      </p>
    </div>
  );
}
