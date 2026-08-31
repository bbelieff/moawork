import Link from "next/link";
import { notFound } from "next/navigation";
import { applyAs, getSession } from "@/lib/auth/session";
import { getCrmService, NotFoundError } from "@/lib/crm";
import { getRepo } from "@/lib/repo";
import { canReassignDeal } from "@/lib/deal/permissions";
import { DealInfoTab } from "@/components/deal/DealInfoTab";
import { DealTimeline } from "@/components/deal/detail/DealTimeline";
import { DealAssignee } from "@/components/deal/detail/DealAssignee";
import { DealFollowupRequest } from "@/components/deal/detail/DealFollowupRequest";
import { DealFiles } from "@/components/deal/detail/DealFiles";
import { DealLedgerButton } from "@/components/board/DealLedgerButton";
import { moveStageAction } from "./actions";
import { listComments } from "@/lib/deal/comments";
import { listDealFiles as listDealFilesAsync } from "@/lib/deal/files";
import { buildDownloadUrl } from "@/lib/deal/fileSignedUrl";
import { listOrgMemberOptions, toNameMap } from "@/lib/deal/members";
import { mergeTimeline } from "@/lib/deal/timeline";
import type { Stage } from "@/lib/types";
import { ChecklistPanel } from "@/components/policyfund/ChecklistPanel";
import { checklistProductCategory, ChecklistService, LocalChecklistStore, SupabaseChecklistStore } from "@/lib/policyfund/checklist";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalSeedFallback } from "@/lib/supabase/local-fallback";
import { EsignPanel } from "@/components/deal/EsignPanel";
import { loadPermGuard } from "@/lib/perm/guard";

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

  const [activities, pipelines, company, comments, members, dealFiles] = await Promise.all([
    svc.listActivities(ctx, deal.id),
    svc.listPipelines(ctx),
    deal.company_id
      ? svc.getCompany(ctx, deal.company_id).catch(() => undefined)
      : Promise.resolve(undefined),
    listComments(ctx, deal.id),
    listOrgMemberOptions(ctx),
    listDealFilesAsync(ctx, deal.id),
  ]);

  const allStages: Stage[] = pipelines.flatMap((p) => p.stages);
  const stage = allStages.find((s) => s.id === deal.stage_id);

  // 커스텀필드 정의은 아직 동기 포트에서 읽는다(T05 소유 영역, BBE-16 범위 밖).
  const repo = getRepo();
  const contractStatusDef = repo
    .listFieldDefs(ctx.org.id, "deal")
    .find((d) => d.label === "계약상황" || d.key === "계약상황");

  const nameById = toNameMap(members);
  const timelineEntries = mergeTimeline(activities, comments);
  const mentionCandidates = members.filter((m) => m.id !== ctx.user.id);
  const downloadUrlById = new Map(dealFiles.map((f) => [f.id, buildDownloadUrl(deal.id, f.id)]));

  // 담당범위: 매니저이거나 본인 담당이면 편집 가능.
  const canEdit =
    ctx.role === "owner" ||
    ctx.role === "admin" ||
    ctx.scope === "all" ||
    deal.assigned_to === ctx.user.id;

  // ★ 재배정만은 «본인 담당» 으로 열어 주면 안 된다.
  // 저장 계층(localRepo·supabaseCrmSource)이 `canSeeAll(ctx)` 가 아니면 assigned_to 를
  // 조용히 버린다(권한 상승 방지). canEdit 을 그대로 쓰면 담당 멤버에게 셀렉트가 열린 채
  // 바꿔도 새로고침하면 되돌아가고 안내도 없다 — 무음 실패다.
  // 그래서 화면 게이트를 저장 계층 규칙과 «같은 조건» 으로 맞춘다(permissions.test.ts 가 고정).
  const canReassign = canReassignDeal(ctx);
  // ★ BBE-203 — 이 화면의 «본문» 은 위에서 getRepo() 로 이미 다 읽었다. 체크리스트와
  //   전자계약은 부수 정보인데, 예전엔 그 둘 때문에 createClient() 가 던져
  //   **페이지 전체가 500** 이었다. 로컬 시드에서 업무 상세를 못 본 이유가 이 두 줄이다.
  //   env 가 있으면 동작은 예전과 완전히 같다.
  const supabase = canUseLocalSeedFallback() ? null : await createClient();
  // 체크리스트도 전자계약과 «같은 규칙» 이다 — 못 불러온 것을 «항목이 없는 것» 으로 보여주지 않는다.
  //   빈 배열로 떨어뜨리면 촬영하는 사람이 그것을 진짜 빈 상태로 오해한다(§3 거짓 빈 상태 금지).
  const checklistService = new ChecklistService(ctx.org.id, supabase ? new SupabaseChecklistStore(supabase) : new LocalChecklistStore(ctx));
  const [checklist, checklistPresets, presetPermission] = await Promise.all([
    checklistService.getDealChecklist(deal.id),
    checklistService.listPresets(),
    loadPermGuard(ctx.org.id, "structure.preset_edit"),
  ]);
  const esignRow = supabase
    ? await supabase.from("esign_requests").select("status")
        .eq("org_id", ctx.org.id).eq("deal_id", deal.id).maybeSingle()
    : null;
  // 로컬에는 전자계약 백엔드가 없다. 「아직 요청하지 않았어요」로 보이면 «거짓 빈 상태» 다(§3).
  // 「불러오지 못했어요」가 사실이므로 조회 불가로 넘긴다.
  const esignStatus = esignRow?.data?.status ?? null;
  const esignUnavailable = esignRow ? Boolean(esignRow.error) : true;

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
            <input type="hidden" name="requestId" value={crypto.randomUUID()} />
            <input type="hidden" name="expectedVersion" value={deal.case_version ?? 0} />
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

      <Section title="담당자">
        <div id="deal-approval-actions" className="flex flex-wrap items-end gap-3">
          <DealAssignee
            dealId={deal.id}
            currentAssigneeId={deal.assigned_to}
            members={members}
            disabled={!canReassign}
          />
          <DealFollowupRequest dealId={deal.id} />
        </div>
      </Section>

      <Section title="회계 원장">
        <DealLedgerButton dealId={deal.id} />
      </Section>

      <Section title="타임라인 · 댓글">
        <DealTimeline
          dealId={deal.id}
          entries={timelineEntries}
          nameById={nameById}
          currentUserId={ctx.user.id}
          canComment
          mentionCandidates={mentionCandidates}
        />
      </Section>

      <Section title={`첨부 (${dealFiles.length})`}>
        <DealFiles
          dealId={deal.id}
          files={dealFiles}
          downloadUrlById={downloadUrlById}
          canEdit={canEdit}
        />
      </Section>

      <Section title="서류 체크리스트">
        {checklist ? (
          <ChecklistPanel
            dealId={deal.id}
            initialState={checklist}
            productCategory={checklistProductCategory(checklistPresets.map((preset) => preset.productId))}
            productPresets={checklistPresets}
            readOnly={!canEdit}
            canManagePresets={presetPermission.kind === "allowed"}
          />
        ) : (
          <p role="alert" className="text-sm" style={{ color: "var(--mw-error)" }}>
            서류 체크리스트를 불러오지 못했어요.
          </p>
        )}
      </Section>

      <Section title="전자계약">
        <EsignPanel dealId={deal.id} initialStatus={esignStatus} initialError={esignUnavailable} canEdit={canEdit} />
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
