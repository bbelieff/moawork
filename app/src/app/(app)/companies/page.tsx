import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { getCrmService } from "@/lib/crm";

/**
 * 고객사 목록 (T02 · core.crm).
 *
 * 담당범위가 적용된다 — 매니저(owner/admin·scope=all)는 조직 전체, 그 외는 본인 담당만.
 * 딜 건수를 함께 보여줘 어느 업체가 진행 중인지 한눈에 보이게 했다.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const svc = getCrmService();

  const [companies, deals] = await Promise.all([
    svc.listCompanies(ctx),
    svc.listDeals(ctx),
  ]);

  const dealCount = new Map<string, number>();
  for (const d of deals) {
    if (d.company_id)
      dealCount.set(d.company_id, (dealCount.get(d.company_id) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">고객사</h1>
          <p className="text-sm text-zinc-500">
            담당 범위에 속한 업체를 보여줍니다.
          </p>
        </div>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {companies.length}곳
        </span>
      </header>

      {companies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
          <p className="text-sm font-medium">등록된 고객사가 없습니다</p>
          <p className="mt-1 text-sm text-zinc-500">
            온보딩에서 정책자금 프리셋을 설치하면 예시 데이터가 생성됩니다.
          </p>
          <Link
            href="/onboarding"
            className="mt-4 inline-block rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            온보딩으로 이동
          </Link>
        </div>
      ) : (
        <div>
          <p id="companies-table-hint" className="mb-2 text-xs text-zinc-500 sm:hidden">
            표를 좌우로 움직이면 모든 정보를 확인할 수 있습니다.
          </p>
          <div className="overflow-x-auto rounded-lg focus-within:ring-2 focus-within:ring-violet-500" tabIndex={0} aria-describedby="companies-table-hint">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">접근 가능한 고객사 목록과 기본 정보, 진행 업무 건수</caption>
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">업체명</th>
                <th className="py-2 pr-4 font-medium">대표자</th>
                <th className="py-2 pr-4 font-medium">업종</th>
                <th className="py-2 pr-4 font-medium">지역</th>
                <th className="py-2 pr-4 text-right font-medium">진행 건</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                >
                  <td className="py-2.5 pr-4 font-medium">
                    <Link
                      href={`/companies/${c.id}`}
                      className="inline-flex min-h-11 items-center rounded-md text-zinc-950 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:text-zinc-50 dark:focus-visible:outline-zinc-100"
                      aria-label={`${c.name} 고객사 상세 보기`}
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-600 dark:text-zinc-400">
                    {c.owner_name ?? "—"}
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-600 dark:text-zinc-400">
                    {c.biz_type ?? "—"}
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-600 dark:text-zinc-400">
                    {c.region ?? "—"}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {dealCount.get(c.id) ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
