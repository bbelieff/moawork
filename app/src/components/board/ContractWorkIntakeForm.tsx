"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { rankCompanies, type CompanyPickerRow } from "@/lib/companies/search";
import {
  workspaceBaseFromPathname,
  workspaceHref,
} from "@/components/shell/workspace-href";
import type { CompanyIntakeActionState } from "@/app/(app)/boards/[id]/company-intake-actions";

const INITIAL_ACTION_STATE: CompanyIntakeActionState = { ok: null, message: "" };

/**
 * 계약업체 실무의 「＋ 업체 추가」 — 목업 `openPicker` 를 옮긴 것이다.
 *
 * 왜 이름 입력칸이 아닌가
 *   이 보드의 한 줄은 «자금 건» 이고, 자금 건은 언제나 «어느 회사의» 것이다.
 *   이름만 받으면 같은 회사가 이름 표기만 달리해서 여러 번 들어온다 —
 *   그러면 업체관리 현황에서 한 회사가 여러 줄로 쪼개진다.
 *   목업이 그걸 한 줄로 못박아 뒀다:
 *     「이미 있는 업체를 고르면 저장된 정보가 그대로 채워집니다 — 같은 회사를 두 번 적지 않게」
 *
 * ★ 같은 회사를 «여러 번» 진행하는 것이 정상이다
 *   회사 하나에 자금 건이 3건일 수 있다(목업 note: 「한 회사에 매출이 여러 번 일어난다」).
 *   그래서 이미 이력이 있는 회사도 고를 수 있어야 하고, 오히려 위로 올려 준다.
 */
export function ContractWorkIntakeForm({
  rows,
  loadError,
  startWorkAction,
  requestId,
  boardId,
  inputClassName,
}: {
  rows: readonly CompanyPickerRow[];
  loadError?: string | null;
  startWorkAction: (
    previous: CompanyIntakeActionState,
    formData: FormData,
  ) => Promise<CompanyIntakeActionState>;
  /** 같은 «추가» 를 두 번 눌러도 건이 둘 생기지 않게 하는 열쇠. 서버가 발급한다. */
  requestId: string;
  boardId: string;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, action, pending] = useActionState(startWorkAction, INITIAL_ACTION_STATE);
  // 「업체관리 현황」으로 보내는 링크는 «지금 회사의» 것이어야 한다 —
  // 네임스페이스를 잃으면 남의 워크스페이스로 보내는 대신 진입 화면으로 튕긴다.
  const companiesHref = workspaceHref(
    workspaceBaseFromPathname(usePathname()) ?? undefined,
    "/companies",
  );

  const shown = useMemo(() => rankCompanies(rows, query), [rows, query]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-mw-sub hover:text-mw-fg"
      >
        <span aria-hidden="true">＋</span> 업체 추가
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          업체 추가 <span className="font-normal text-mw-sub">— 회사명을 먼저 찾습니다</span>
        </h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-mw-sub hover:text-mw-fg">
          닫기
        </button>
      </div>

      <input
        autoFocus
        disabled={Boolean(loadError) || pending}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // 목업의 안내를 그대로 옮기되, 총괄 지시로 «회사에 붙은 것 전부» 를 찾는다고 적는다.
        placeholder="회사명 · 대표자 · 연락처로 찾을 수 있어요 (초성도 됩니다)"
        aria-label="업체 검색"
        className={inputClassName}
      />

      <ul className="max-h-72 overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800" aria-busy={pending}>
        {loadError ? (
          <li role="alert" className="px-3 py-6 text-center text-sm text-[var(--mw-error)]">
            {loadError}
          </li>
        ) : shown.map(({ company, dealCount }) => (
          <li key={company.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-900">
            <form action={action}>
              <input type="hidden" name="companyId" value={company.id} />
              <input type="hidden" name="requestId" value={requestId} />
              <input type="hidden" name="boardId" value={boardId} />
              <button
                type="submit"
                disabled={pending}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200"
                >
                  {company.name.trim().charAt(0) || "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{company.name}</b>
                  <span className="block truncate text-[11px] text-mw-sub">
                    {[company.owner_name, company.biz_type, company.region, company.phone].filter(Boolean).join(" · ") || "저장된 정보 없음"}
                  </span>
                </span>
                <span className="flex-none text-right text-[11px]">
                  {dealCount > 0 ? (
                    <b className="font-semibold text-violet-700 dark:text-violet-300">진행 이력 {dealCount}건</b>
                  ) : (
                    <span className="text-mw-sub">이력 없음</span>
                  )}
                </span>
              </button>
            </form>
          </li>
        ))}

        {!loadError && shown.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-mw-sub">
            «{query.trim()}» 로 찾은 업체가 없습니다
          </li>
        ) : null}
      </ul>

      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-xs ${state.ok ? "text-[var(--mw-success)]" : "text-[var(--mw-error)]"}`}
        >
          {state.message}
        </p>
      ) : null}

      {/*
        새 업체 등록은 «맨 아래» 다. 목업도 같다 — 위에 두면 찾아보기 전에 눌러서 중복이 는다.
        지금은 회사 등록 경로가 따로 있으므로(회사 CSV 가져오기·리드컨택에서 넘어옴) 그리로 보낸다.
      */}
      {!loadError ? <p className="text-[11px] text-mw-sub">
        이미 있는 업체를 고르면 <b>저장된 정보가 그대로 채워집니다</b> — 같은 회사를 두 번 적지 않게.
        <br />
        찾는 업체가 없다면 <Link href={companiesHref} className="underline underline-offset-2">업체관리 현황</Link>에서 먼저 등록해 주세요.
      </p> : null}
    </div>
  );
}
