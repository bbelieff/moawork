import Link from "next/link";
import type { Company, Deal } from "@/lib/types";

export interface CompanyDetailProps {
  company: Company;
  deals: Deal[];
  stageNames: ReadonlyMap<string, string>;
  workStartRequestId: string;
  workStartStatus?: "ok" | "failed" | "invalid";
  startedDealId?: string;
  startWorkAction: (formData: FormData) => Promise<void>;
}

function formatRevenue(value: number | null): string {
  return value === null ? "—" : `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function safeHomepage(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function CompanyDetail({ company, deals, stageNames, workStartRequestId, workStartStatus, startedDealId, startWorkAction }: CompanyDetailProps) {
  const homepage = safeHomepage(company.homepage);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <Link
          href="/companies"
          className="w-fit rounded text-sm text-zinc-500 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
        >
          ← 고객사 목록
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-violet-700 dark:text-violet-300">고객사 상세</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{company.name}</h1>
          </div>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            진행 {deals.length}건
          </span>
        </div>
      </header>

      <section aria-labelledby="company-profile-title" className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="company-profile-title" className="font-semibold">기본 정보</h2>
            <p className="mt-1 text-sm text-zinc-500">연락 정보는 이 고객사를 볼 수 있는 구성원에게만 표시됩니다.</p>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">고객 정보</span>
        </div>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="대표자" value={company.owner_name} />
          <Detail label="업종" value={company.biz_type} />
          <Detail label="지역" value={company.region} />
          <Detail label="전화" value={company.phone} />
          <Detail label="이메일" value={company.email} />
          <Detail label="설립일" value={company.founded_on} />
          <Detail label="매출" value={formatRevenue(company.revenue)} />
          <div>
            <dt className="text-xs font-medium text-zinc-500">홈페이지</dt>
            <dd className="mt-1 break-all text-sm">
              {homepage ? (
                <a className="rounded text-violet-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-violet-300" href={homepage} target="_blank" rel="noreferrer">
                  사이트 열기<span className="sr-only"> (새 창)</span>
                </a>
              ) : company.homepage ? "확인할 수 없는 주소" : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="company-deals-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="company-deals-title" className="font-semibold">관련 업무</h2>
          </div>
          <form action={startWorkAction}>
            <input type="hidden" name="companyId" value={company.id} />
            <input type="hidden" name="requestId" value={workStartRequestId} />
            <button type="submit" className="min-h-11 rounded-lg bg-mw-primary px-4 py-2 text-sm font-semibold text-white hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mw-primary">
              업무 시작
            </button>
          </form>
        </div>
        {workStartStatus === "ok" ? (
          <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">업무를 시작했습니다. {startedDealId ? <Link className="font-semibold underline" href={`/deals/${startedDealId}`}>업무 열기</Link> : null}</p>
        ) : workStartStatus ? (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">업무를 시작하지 못했습니다. 권한과 업무 보드 구성을 확인한 뒤 다시 시도해 주세요.</p>
        ) : null}
        {deals.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 px-5 py-6 text-center dark:border-zinc-700">
            <p className="font-medium">연결된 업무가 없습니다</p>
            <p className="mt-1 text-sm text-zinc-500">새 업무를 만들 때 이 고객사를 연결하면 여기에 표시됩니다.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {deals.map((deal) => (
              <li key={deal.id}>
                <Link
                  href={`/deals/${deal.id}`}
                  className="flex min-h-24 flex-col justify-between rounded-md border border-zinc-200 bg-white p-4 transition hover:border-mw-primary hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mw-primary dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-mw-primary"
                >
                  <span className="font-medium">{deal.title}</span>
                  <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>{deal.stage_id ? stageNames.get(deal.stage_id) ?? "단계 미확인" : "단계 미배정"}</span>
                    <span className="tabular-nums">{deal.amount === null ? "금액 미입력" : `${new Intl.NumberFormat("ko-KR").format(deal.amount)}원`}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 break-words text-sm">{value || "—"}</dd>
    </div>
  );
}
