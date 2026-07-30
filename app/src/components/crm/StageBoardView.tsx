import Link from "next/link";
import type { StageBoardData } from "@/lib/crm/boardData";

/**
 * 단계 보드 화면 (T02 · B2) — 먼데이 보드와 같은 "단계별 열 + 행" 형태.
 *
 * 서버 컴포넌트(읽기 전용). 드래그 이동·인라인 편집은 후속(B2 이후) —
 * 단계 이동은 활동로그를 남겨야 해서 서비스(moveDealStage) 경유가 필수다.
 */
export function StageBoardView({ data }: { data: StageBoardData }) {
  const { board, columns, total, companyById, sourceKind } = data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{board.title}</h1>
          <p className="text-sm text-neutral-500">{board.description}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">
            {total}건
          </span>
          {sourceKind === "local" && (
            <span
              className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800"
              title="Supabase 환경변수가 없어 로컬 인메모리 데이터를 보고 있습니다."
            >
              로컬 데이터
            </span>
          )}
        </div>
      </header>

      {columns.length === 0 ? (
        <EmptyState
          title="단계가 아직 없습니다"
          hint="온보딩에서 정책자금 프리셋을 설치하면 파이프라인 단계가 생성됩니다."
          href="/onboarding"
          cta="온보딩으로 이동"
        />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {columns.map(({ stage, deals }) => (
            <section
              key={stage.id}
              className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-neutral-50 p-3"
            >
              <h2 className="flex items-center justify-between text-sm font-medium">
                <span>{stage.name}</span>
                <span className="text-neutral-500">{deals.length}</span>
              </h2>

              {deals.length === 0 ? (
                <p className="py-6 text-center text-xs text-neutral-400">
                  해당 단계의 건이 없습니다
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {deals.map((deal) => {
                    const company = deal.company_id
                      ? companyById.get(deal.company_id)
                      : undefined;
                    return (
                      <li key={deal.id}>
                        <Link
                          href={`/deals/${deal.id}`}
                          className="block rounded-md bg-white p-3 shadow-sm transition hover:shadow"
                        >
                          <p className="text-sm font-medium">{deal.title}</p>
                          {company && (
                            <p className="mt-0.5 text-xs text-neutral-500">
                              {company.name}
                            </p>
                          )}
                          {deal.amount !== null && (
                            <p className="mt-1 text-xs tabular-nums text-neutral-600">
                              {deal.amount.toLocaleString("ko-KR")}원
                            </p>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  title,
  hint,
  href,
  cta,
}: {
  title: string;
  hint: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-neutral-500">{hint}</p>
      <Link
        href={href}
        className="mt-4 inline-block rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white"
      >
        {cta}
      </Link>
    </div>
  );
}
