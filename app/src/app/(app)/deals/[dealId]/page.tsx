import Link from "next/link";
import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { getCrmService, NotFoundError } from "@/lib/crm";
import { getRepo } from "@/lib/repo";
import { listDealFiles } from "@/lib/services/files";
import { DealInfoTab } from "@/components/deal/DealInfoTab";
import { DealActivityTab } from "@/components/deal/DealActivityTab";
import { DealFilesPanel } from "@/components/deal/DealFilesPanel";
import { moveStageAction } from "./actions";
import type { Stage } from "@/lib/types";

/**
 * 딜 상세 (T02 · core.crm).
 *
 * 보드 카드에서 들어오는 드릴인 화면. 정보/활동/첨부를 한 화면에 세로로 쌓았다
 * (탭 전환은 클라이언트 상태가 필요한데, 서버 렌더만으로 전부 보여주는 편이
 *  링크 공유·새로고침에 강하다).
 *
 * 저장은 전부 서버 액션 → `getCrmService()` 경로다(env 있으면 실 Supabase).
 */
export default async function DealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { dealId } = await params;
  const sp = await searchParams;
  const ctx = applyAs(await getSession(), sp.as);
  const svc = getCrmService();

  let deal;
  try {
    deal = await svc.getDeal(ctx, dealId);
  } catch (err) {
    // 담당범위 밖이면 존재 자체를 흘리지 않는다 — 404 로 수렴.
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const [activities, pipelines, company] = await Promise.all([
    svc.listActivities(ctx, deal.id),
    svc.listPipelines(ctx),
    deal.company_id
      ? svc.getCompany(ctx, deal.company_id).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  const allStages: Stage[] = pipelines.flatMap((p) => p.stages);
  const stage = allStages.find((s) => s.id === deal.stage_id);

  // 커스텀필드 정의·사용자·첨부는 아직 동기 포트에서 읽는다(T05/T04 소유 영역).
  const repo = getRepo();
  const contractStatusDef = repo
    .listFieldDefs(ctx.org.id, "deal")
    .find((d) => d.label === "계약상황" || d.key === "계약상황");
  const userById = new Map(repo.listUsers().map((u) => [u.id, u]));
  const files = listDealFiles(ctx, deal.id);

  // 담당범위: 매니저이거나 본인 담당이면 편집 가능.
  const canEdit =
    ctx.role === "owner" ||
    ctx.role === "admin" ||
    ctx.scope === "all" ||
    deal.assigned_to === ctx.user.id;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link
          href="/newcust"
          className="text-xs text-zinc-500 hover:underline"
        >
          ← 업무 보드로
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{deal.title}</h1>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {stage?.name ?? "단계 미배정"}
          </span>
        </div>

        {canEdit && allStages.length > 0 && (
          <form action={moveStageAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="dealId" value={deal.id} />
            <label className="text-xs text-zinc-500" htmlFor="stageId">
              단계 이동
            </label>
            <select
              id="stageId"
              name="stageId"
              defaultValue={deal.stage_id ?? ""}
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {allStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              단계 옮기기
            </button>
            <span className="text-xs text-zinc-400">이동하면 활동 기록을 남겨요.</span>
          </form>
        )}
      </header>

      <Section title="정보">
        <DealInfoTab
          deal={deal}
          company={company}
          stage={stage}
          contractStatusDef={contractStatusDef}
          canEdit={canEdit}
        />
      </Section>

      <Section title="활동">
        <DealActivityTab
          dealId={deal.id}
          activities={activities}
          userById={userById}
        />
      </Section>

      <Section title={`첨부 (${files.length})`}>
        <DealFilesPanel dealId={deal.id} files={files} canEdit={canEdit} />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}
