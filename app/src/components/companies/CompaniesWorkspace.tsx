"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { CompaniesViewModel, CompanyDealView, CompanyView } from "@/lib/companies/server";
import { COMPANY_STATUS_COLUMNS, totalsFrom } from "@/lib/companies/status";

const won = new Intl.NumberFormat("ko-KR");

/** 목업과 같은 «비어 있음» 표기. 0원과 «아직 없다» 를 눈으로 구분할 수 있어야 한다. */
const DASH = "—";

function money(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : `${won.format(value)}원`;
}

/** 목업의 `dt()` 와 같은 규칙 — 연도 앞 두 자리를 떼고 `26-08-24` 로 짧게 적는다. */
function shortDate(value: string | null | undefined): string {
  if (!value) return DASH;
  const day = value.slice(0, 10);
  return day.length === 10 ? day.slice(2) : day;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">{value}</p>
      <p className="mt-0.5 h-4 text-[11px] text-zinc-400">{hint ?? ""}</p>
    </div>
  );
}

const chip =
  "inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
const chipActive =
  "inline-flex items-center gap-1 rounded-lg border border-violet-400 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 dark:border-violet-600 dark:bg-violet-950 dark:text-violet-200";

function Cell({ children, align }: { children: ReactNode; align: "left" | "right" }) {
  return (
    <td className={`whitespace-nowrap px-3 py-2 ${align === "right" ? "text-right tabular-nums" : "text-left"}`}>
      {children}
    </td>
  );
}

function DealRow({ row, hidden }: { row: CompanyDealView; hidden: boolean }) {
  const { deal, money: m } = row;
  // 원장을 못 읽은 건은 돈 다섯 칸을 «0원» 이 아니라 «확인 필요» 로 적는다.
  const unreadable = m === null;
  const amount = (value: number | null | undefined) => (unreadable ? "확인 필요" : money(value));

  return (
    <tr hidden={hidden} className="border-t border-zinc-100 text-sm dark:border-zinc-900">
      <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 dark:bg-zinc-950">
        <span aria-hidden="true" className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-violet-400" />
        <Link href={`/deals/${deal.id}`} className="underline-offset-4 hover:underline">
          {deal.title}
        </Link>
      </td>
      {/* 진행기관 — 아직 딜에 이 필드가 없다. 자리를 비워 두고 «없다» 를 말한다(#531 후속). */}
      <Cell align="left"><span className="text-zinc-400">{DASH}</span></Cell>
      <Cell align="left">{row.ownerName ?? <span className="text-zinc-400">미지정</span>}</Cell>
      <Cell align="left">{row.statusLabel ?? <span className="text-zinc-400">{DASH}</span>}</Cell>
      <Cell align="left">{shortDate(deal.applied_on)}</Cell>
      {/* 승인 — 승인«일» 을 담는 필드가 제품에 아직 없다(#531 후속). */}
      <Cell align="left"><span className="text-zinc-400">{DASH}</span></Cell>
      <Cell align="right">{money(deal.amount)}</Cell>
      {/* ★ 목업의 «수수료율(%)» 자리 — 총괄 직접 지시로 «계약조건» 자유기재다. */}
      <Cell align="left">{deal.fee_terms || <span className="text-zinc-400">{DASH}</span>}</Cell>
      <Cell align="right">{amount(m?.contractDeposit)}</Cell>
      <Cell align="left">{shortDate(m?.contractDepositPaidOn)}</Cell>
      <Cell align="right">{amount(m?.fee)}</Cell>
      <Cell align="left">{shortDate(m?.feeBilledOn)}</Cell>
      <Cell align="left">{shortDate(m?.feePaidOn)}</Cell>
    </tr>
  );
}

function CompanyRow({
  view,
  open,
  onToggle,
  dealsUnknown,
}: {
  view: CompanyView;
  open: boolean;
  onToggle: () => void;
  dealsUnknown: boolean;
}) {
  /*
   * 회사 줄은 «그 회사의 자금 건 전체를 접은 것» 이다(목업 `.corow`).
   * 그래서 각 칸에는 회사의 속성이 아니라 **건들을 접은 값** 이 들어간다.
   * 대표·업종·지역은 열이 아니라 첫 칸 아래 작은 줄에 붙는다 — 목업 그대로다.
   * (여기에 지역을 «진행기관» 칸에 넣는 식으로 어긋나면 그게 곧 자리 틀림이다.)
   */
  const owners = [...new Set(view.deals.map((row) => row.ownerName).filter(Boolean))];
  const approved = view.deals.filter((row) => row.statusLabel === "승인").length;
  const startedOn = view.deals.map((row) => row.deal.applied_on).filter(Boolean).sort()[0] ?? null;
  const execution = view.deals.reduce((total, row) => total + (row.deal.amount ?? 0), 0);
  const deposit = view.deals.reduce((total, row) => total + (row.money?.contractDeposit ?? 0), 0);
  const fee = view.deals.reduce((total, row) => total + (row.money?.fee ?? 0), 0);
  const outstanding = view.deals.reduce((total, row) => total + (row.money?.outstanding ?? 0), 0);
  const identity = [view.company.owner_name, view.company.biz_type, view.company.region].filter(Boolean).join(" · ");

  return (
    <>
      <tr className="border-t border-zinc-200 bg-zinc-50/70 text-sm font-medium dark:border-zinc-800 dark:bg-zinc-900/50">
        <th
          scope="row"
          className="sticky left-0 z-10 whitespace-nowrap bg-zinc-50 px-3 py-2 text-left font-semibold dark:bg-zinc-900"
        >
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-2">
            <span aria-hidden="true" className={`text-zinc-400 transition ${open ? "rotate-180" : ""}`}>⌄</span>
            <span>{view.company.name}</span>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200">
              {dealsUnknown ? "확인 필요" : `자금 ${view.deals.length}건`}
            </span>
          </button>
          {identity ? <p className="ml-6 mt-0.5 text-[11px] font-normal text-zinc-500">{identity}</p> : null}
        </th>
        {/* 진행기관 — 건들의 고유값이 들어갈 자리. 아직 필드가 없어서 비어 있다(#531 후속). */}
        <Cell align="left"><span className="text-zinc-400">{DASH}</span></Cell>
        <Cell align="left">
          {owners.length ? <span className="font-normal text-zinc-600 dark:text-zinc-300">{owners.join(", ")}</span> : <span className="text-zinc-400">{DASH}</span>}
        </Cell>
        <Cell align="left">
          {approved > 0 ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">승인 {approved}</span>
          ) : (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-200">진행 중</span>
          )}
        </Cell>
        <Cell align="left"><span className="font-normal text-zinc-500">{shortDate(startedOn)}</span></Cell>
        <Cell align="left"><span className="text-zinc-400">{DASH}</span></Cell>
        <Cell align="right">{money(execution)}</Cell>
        {/* 계약조건은 건마다 다르다 — 접은 줄에서는 뜻이 없어 비운다(목업도 «—»). */}
        <Cell align="left"><span className="text-zinc-400">{DASH}</span></Cell>
        <Cell align="right">{money(deposit)}</Cell>
        <Cell align="left"><span className="text-zinc-400">{DASH}</span></Cell>
        <Cell align="right">{money(fee)}</Cell>
        <Cell align="left"><span className="text-zinc-400">{DASH}</span></Cell>
        <Cell align="left">
          {outstanding > 0 ? (
            <span className="font-semibold text-rose-600 dark:text-rose-400">미수 {money(outstanding)}</span>
          ) : (
            <span className="text-xs font-normal text-emerald-700 dark:text-emerald-400">완납</span>
          )}
        </Cell>
      </tr>
      {/*
        ★ 접었다고 «DOM 에서 빼지» 않는다 — `hidden` 으로 감춘다.
          예전 이 화면은 `<details>` 였고, 접혀 있어도 내용이 문서에 남아 있었다.
          브라우저 찾기(Ctrl+F)·보조기술이 그걸 찾을 수 있었다는 뜻이다.
          표에는 `<details>` 로 `<tr>` 을 감쌀 수 없어서 상태로 바꿨는데,
          그때 조건부 렌더로 지워 버리면 그 성질을 조용히 잃는다.
          `hidden` 은 화면에서도 보조기술에서도 감추므로 «접힘» 의 뜻은 그대로다.
      */}
      {view.deals.map((row) => <DealRow key={row.deal.id} row={row} hidden={!open} />)}
    </>
  );
}

export function CompaniesWorkspace({ model, importSlot }: { model: CompaniesViewModel; importSlot?: ReactNode }) {
  const companies = model.status === "ready" ? model.companies : [];
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("전체");
  const [status, setStatus] = useState("전체");
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const owners = useMemo(() => {
    const names = new Set<string>();
    for (const view of companies) for (const row of view.deals) if (row.ownerName) names.add(row.ownerName);
    return ["전체", ...[...names].sort()];
  }, [companies]);

  const statuses = useMemo(() => {
    const names = new Set<string>();
    for (const view of companies) for (const row of view.deals) if (row.statusLabel) names.add(row.statusLabel);
    return ["전체", ...[...names].sort()];
  }, [companies]);

  const shown = useMemo(() => {
    const needle = query.trim();
    return companies
      .map((view) => ({
        ...view,
        deals: view.deals.filter(
          (row) =>
            (owner === "전체" || row.ownerName === owner) &&
            (status === "전체" || row.statusLabel === status) &&
            (!unpaidOnly || (row.money?.outstanding ?? 0) > 0),
        ),
      }))
      // 검색은 회사 이름으로만 한다 — 목업의 «회사명 검색» 그대로다.
      .filter((view) => (needle === "" ? true : view.company.name.includes(needle)))
      // 담당자·상태·미수금 필터가 걸린 동안에는 «해당 건이 하나도 없는 회사» 를 숨긴다.
      // 필터를 안 건 상태에서는 건이 없는 회사도 그대로 보여야 한다(회사 마스터이기 때문).
      .filter((view) =>
        owner === "전체" && status === "전체" && !unpaidOnly ? true : view.deals.length > 0,
      );
  }, [companies, query, owner, status, unpaidOnly]);

  const totals = useMemo(
    () =>
      totalsFrom(
        shown.map((view) => ({
          deals: view.deals.map((row) => ({
            executionAmount: row.deal.amount,
            money: row.money ?? {
              contractDeposit: null, contractDepositPaidOn: null, fee: null,
              feeBilledOn: null, feePaidOn: null, ledgerTotal: 0, outstanding: 0,
            },
          })),
        })),
      ),
    [shown],
  );

  if (model.status === "unconfigured") {
    // 오류가 아니라 «아직 연결 안 됨». 빈 회사 목록으로 위장하지 않는다.
    return (
      <section role="status" className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold">워크스페이스 데이터에 아직 연결되지 않았습니다</h1>
        <p className="mt-2 text-sm text-zinc-500">회사 목록은 워크스페이스 데이터베이스에서 옵니다. 연결되면 여기에 바로 나옵니다.</p>
      </section>
    );
  }

  if (model.status === "error") {
    return (
      <section role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
        <h1 className="text-xl font-semibold">회사 정보를 불러오지 못했습니다</h1>
        <p className="mt-2 text-sm">DB 연결을 확인한 뒤 다시 시도해 주세요. 실패를 빈 회사 목록으로 표시하지 않습니다.</p>
      </section>
    );
  }

  const dealsUnknown = model.dealsStatus === "error";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">업체관리 현황</h1>
          <p className="mt-1 text-sm text-zinc-500">회사 1행 · 펼치면 자금 건별 이력 · 금액은 원장 합계</p>
        </div>
        {importSlot}
      </header>

      {/* KPI — 목업 `.kpis` 와 같은 5칸, 같은 순서 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="업체" value={`${totals.companyCount}`} />
        <Kpi
          label="자금 건"
          value={dealsUnknown ? "확인 필요" : `${totals.dealCount}`}
          hint={totals.dealCount ? `회사당 ${(totals.dealCount / Math.max(totals.companyCount, 1)).toFixed(1)}건` : ""}
        />
        <Kpi label="누적 실행액" value={money(totals.executionTotal)} />
        <Kpi label="누적 수수료" value={money(totals.feeTotal)} />
        <Kpi label="미수금" value={money(totals.outstandingTotal)} hint={totals.outstandingTotal ? "확인 필요" : ""} />
      </div>

      {dealsUnknown ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          업무 목록을 불러오지 못했습니다. 회사 목록은 유지하며 업무 건수를 0건으로 표시하지 않습니다.
        </p>
      ) : null}

      {/* 필터 줄 — 목업과 같은 6개, 같은 순서. 네이티브 select 를 쓰지 않는다(집안 규약). */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
        <label className={chip}>
          <span className="text-zinc-500">회사명 검색</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-32 bg-transparent outline-none placeholder:text-zinc-400"
            placeholder="회사명"
          />
        </label>

        <details className="relative">
          <summary className={owner === "전체" ? chip : chipActive}>담당자{owner === "전체" ? "" : ` · ${owner}`}</summary>
          <div className="absolute z-20 mt-1 min-w-44 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {owners.map((name) => (
              <button key={name} type="button" onClick={() => setOwner(name)} className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                {name}
              </button>
            ))}
          </div>
        </details>

        <details className="relative">
          <summary className={status === "전체" ? chip : chipActive}>진행 상태{status === "전체" ? "" : ` · ${status}`}</summary>
          <div className="absolute z-20 mt-1 min-w-44 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {statuses.map((name) => (
              <button key={name} type="button" onClick={() => setStatus(name)} className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                {name}
              </button>
            ))}
          </div>
        </details>

        <button type="button" aria-pressed={unpaidOnly} onClick={() => setUnpaidOnly((on) => !on)} className={unpaidOnly ? chipActive : chip}>
          미수금만
        </button>

        <span className="flex-1" />

        <button type="button" onClick={() => setOpen(Object.fromEntries(shown.map((view) => [view.company.id, true])))} className={chip}>
          모두 펼치기
        </button>
        <button type="button" onClick={() => setOpen({})} className={chip}>
          모두 접기
        </button>
      </div>

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">업체 · 자금 건</h2>
          <span className="text-xs text-zinc-500">{owner === "전체" ? "전체" : `${owner} 담당분만`}</span>
        </div>

        {shown.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-medium">{companies.length === 0 ? "등록된 회사가 없습니다" : "조건에 맞는 회사가 없습니다"}</p>
            {/* 막다른 길 방지 — «어떻게 넣는가» 를 여기서 알려준다. 빈 화면으로 끝내지 않는다. */}
            <p className="mt-1 text-sm text-zinc-500">
              {companies.length === 0
                ? "위 CSV로 가져오기로 한 번에 등록하거나, 계약업체 실무에서 회사를 연결하면 여기에 표시됩니다."
                : "검색어나 필터를 지우면 다시 보입니다."}
            </p>
          </div>
        ) : (
          // 표는 «자기 안에서만» 가로로 스크롤한다 — 본문이 옆으로 밀리면 안 된다.
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] border-collapse text-sm">
              <thead>
                <tr className="text-xs text-zinc-500">
                  {COMPANY_STATUS_COLUMNS.map((column, index) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={`whitespace-nowrap px-3 py-2 font-medium ${column.align === "right" ? "text-right" : "text-left"} ${
                        index === 0 ? "sticky left-0 z-10 bg-white dark:bg-zinc-950" : ""
                      }`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((view) => (
                  <CompanyRow
                    key={view.company.id}
                    view={view}
                    open={Boolean(open[view.company.id])}
                    onToggle={() => setOpen((prev) => ({ ...prev, [view.company.id]: !prev[view.company.id] }))}
                    dealsUnknown={dealsUnknown}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
