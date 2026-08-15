import Link from "next/link";
import type { CompaniesViewModel, CompanyDealView } from "@/lib/companies/server";

const won = new Intl.NumberFormat("ko-KR");

function Money({ value }: { value: number }) {
  return <span className="tabular-nums">{won.format(value)}원</span>;
}

function DealRow({ row }: { row: CompanyDealView }) {
  return (
    <li className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(7rem,auto))] sm:items-center dark:border-zinc-800 dark:bg-zinc-950">
      <Link href={`/deals/${row.deal.id}`} className="font-medium text-zinc-950 underline-offset-4 hover:underline dark:text-zinc-50">
        {row.deal.title}
      </Link>
      {row.ledger.status === "ready" ? (
        <>
          <span className="text-sm"><span className="text-zinc-500 sm:hidden">원장 합계 · </span><Money value={row.ledger.total} /></span>
          <span className="text-sm"><span className="text-zinc-500 sm:hidden">입금 · </span><Money value={row.ledger.received} /></span>
          <span className="text-sm"><span className="text-zinc-500 sm:hidden">미수 · </span><Money value={row.ledger.outstanding} /></span>
          <span className="text-sm"><span className="text-zinc-500 sm:hidden">수수료 · </span><Money value={row.ledger.fee} /></span>
        </>
      ) : (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 sm:col-span-4 dark:bg-rose-950 dark:text-rose-200">
          원장 금액을 불러오지 못했습니다. 0원으로 계산하지 않았습니다.
        </p>
      )}
    </li>
  );
}

export function CompaniesWorkspace({ model }: { model: CompaniesViewModel }) {
  if (model.status === "error") {
    return (
      <section role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
        <h1 className="text-xl font-semibold">회사 정보를 불러오지 못했습니다</h1>
        <p className="mt-2 text-sm">DB 연결을 확인한 뒤 다시 시도해 주세요. 실패를 빈 회사 목록으로 표시하지 않습니다.</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-violet-700 dark:text-violet-300">회사 마스터</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">회사별 업무와 원장</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500">회사를 펼치면 연결된 딜과 원장 정본 금액을 한 번에 확인할 수 있습니다.</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{model.companies.length}개 회사</span>
      </header>

      {model.dealsStatus === "error" ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          업무 목록을 불러오지 못했습니다. 회사 목록은 유지하며 업무 건수를 0건으로 표시하지 않습니다.
        </p>
      ) : null}

      {model.companies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <p className="font-medium">등록된 회사가 없습니다</p>
          <p className="mt-1 text-sm text-zinc-500">계약업체 실무에서 회사를 연결하면 여기에 표시됩니다.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {model.companies.map(({ company, deals }) => (
            <details key={company.id} className="group rounded-2xl border border-zinc-200 bg-zinc-50/50 open:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/40">
              <summary className="flex min-h-20 cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-zinc-950 dark:text-zinc-50">{company.name}</p>
                  <p className="mt-1 text-sm text-zinc-500">{company.owner_name || "대표자 미입력"} · {company.region || "지역 미입력"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Link href={`/companies/${company.id}`} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">회사 상세</Link>
                  <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200">{model.dealsStatus === "ready" ? `${deals.length}건` : "확인 필요"}</span>
                  <span aria-hidden="true" className="text-zinc-500 transition group-open:rotate-180">⌄</span>
                </div>
              </summary>
              <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
                {model.dealsStatus === "error" ? (
                  <p className="text-sm text-amber-800 dark:text-amber-200">연결된 업무를 불러오지 못했습니다.</p>
                ) : deals.length === 0 ? (
                  <p className="text-sm text-zinc-500">연결된 업무가 없습니다.</p>
                ) : (
                  <>
                    <div aria-hidden="true" className="mb-2 hidden grid-cols-[minmax(0,1fr)_repeat(4,minmax(7rem,auto))] gap-3 px-4 text-xs text-zinc-500 sm:grid">
                      <span>업무</span><span>원장 합계</span><span>입금</span><span>미수</span><span>수수료</span>
                    </div>
                    <ul className="grid gap-2">{deals.map((deal) => <DealRow key={deal.deal.id} row={deal} />)}</ul>
                  </>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
