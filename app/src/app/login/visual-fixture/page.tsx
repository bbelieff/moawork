import { VisualConsultationProbe } from "./VisualConsultationProbe";
import { SavedViewsController } from "@/components/view/SavedViewsController";
import { NotificationCenterFixture } from "./NotificationCenterFixture";
import { VisualDocumentOcrProbe } from "./VisualDocumentOcrProbe";
import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { CONTACT_TAB, NEW_LEAD_TAB } from "@/lib/default-tabs";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import { VisualSettingsSlot } from "./VisualSettingsSlot";
import { NewLeadOnboarding } from "@/components/board/NewLeadOnboarding";
import { cookies } from "next/headers";
import { VisualCompaniesProbe } from "./VisualCompaniesProbe";
import { visualSetCellAction } from "./actions";
import { VisualLayerProbe } from "./VisualLayerProbe";
import { VisualWorkspaceSwitcherProbe } from "./VisualWorkspaceSwitcherProbe";
import { VisualAppearanceProbe } from "./VisualAppearanceProbe";
import { VisualThemeProbe } from "./VisualThemeProbe";
import { IconSprite } from "@/components/shell/icons";
import { AccountHub } from "@/components/account/AccountHub";
import accountStyles from "@/components/account/account.module.css";
import { DepartmentManager } from "@/components/member-organization/DepartmentManager";
import { OrgViewTabs } from "@/components/member-organization/OrgViewTabs";
import { isOrgView } from "@/lib/org/org-view";
import { loadVisualOrgViewModel, loadVisualSeatDefinitions } from "./org-view-fixture";
import {
  loadVisualDepartmentChart,
  visualAssignDepartmentMemberAction,
  visualCreateDepartmentAction,
  visualMoveDepartmentAction,
  visualRenameDepartmentAction,
} from "./department-actions";

function fixture(tabKey: string, workflowValue: string | null, showAllGroups = false) {
  const definition = tabKey === "contact" ? CONTACT_TAB : NEW_LEAD_TAB;
  const board = {
    id: `visual-${definition.key}`, org_id: "visual-org", name: definition.name,
    description: definition.description, icon: definition.icon, is_system: false,
    source: definition.source, sort_order: 0, created_by: "visual-user", created_at: "", updated_at: "",
  } satisfies Board;
  const groups = definition.groups.slice(0, showAllGroups ? undefined : 1).map((group, index) => ({
    id: `visual-group-${index}`, org_id: board.org_id, board_id: board.id,
    name: group.name, color: group.color, sort_order: index,
  })) satisfies BoardGroup[];
  const columns = definition.columns.map((column, index) => ({
    id: `visual-column-${index}`, org_id: board.org_id, board_id: board.id,
    key: column.key, label: column.label, type: column.type, source: column.source,
    rightPinned: Boolean(column.rightPinned), options_jsonb: column.options ? { options: column.options } : null,
    sort_order: index, width: column.width ?? 150, move_rule_jsonb: null,
    is_readonly: Boolean(column.readOnly),
  })) satisfies BoardColumn[];
  const values: ItemWithValues["values"] = tabKey === "new" ? {
    owner: "review-user",
    collaborators: ["visual-user"],
    applied_on: "2026-08-08",
    ad_name: "네이버 정책자금 A",
    phone: "010-2841-0000",
    rep_name: "김성호",
    biz_reg_type: "법인사업자",
    industry: "기계부품 제조",
    revenue_band: "30억~50억",
    sido: "경기",
    sigungu: "화성시",
    email: "dh@—",
    address_detail: "경기 화성시 동탄산단로 12",
    consult_status: "상담 전",
    contact_move: workflowValue ?? "컨택 대기",
  } : workflowValue ? { work_move: workflowValue } : {};
  const rows = groups.map((group, index) => ({
    id: index === 0 ? "visual-item" : `visual-item-${index}`,
    org_id: board.org_id,
    board_id: board.id,
    group_id: group.id,
    title: tabKey === "new" ? `(주)대한정밀${index === 0 ? "" : ` ${index + 1}`}` : `마스킹된 예시 항목 ${index + 1}`,
    assigned_to: tabKey === "new" ? "review-user" : null,
    deal_id: tabKey === "new" ? `visual-deal-${index}` : null,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    values: { ...values },
  })) satisfies ItemWithValues[];
  return { board, groups, columns, rows };
}

export default async function VisualFixturePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.surface === "new-lead-stages") {
    // Synthetic layout/interaction QA only; real actions remain authenticated.
    const sample = fixture("new", null, true);
    const states = ["상담 전", "1차 부재", "2차 상담예약", "2차 상담완료", "보류", "거절", "직접 만든 값"];
    const rows = states.map((state, index) => ({ ...sample.rows[0], id: `stage-qa-${index}`, title: `합성 업체 ${index + 1}`,
      deal_id: null, sort_order: index, values: { ...sample.rows[0].values, consult_status: state } }));
    return <main className="min-h-screen min-w-0 bg-mw-bg p-3"><VisualAppearanceProbe accent="new" controls={false} />
      <BoardWorkspace board={sample.board} columns={sample.columns.filter((column) => ["phone", "consult_status", "contact_move"].includes(column.key))}
        groups={sample.groups} rows={rows} columnOrder={{}} cellFlash={null} assigneeLabels={{}} canEditItems canBulkEditItems canMoveRows
        itemDetailFixture={{ ok: true, events: [], links: [], files: [], members: [] }} />
    </main>;
  }
  if (params.surface === "saved-table") {
    const sample = fixture("new", null, true);
    return <main className="min-h-screen min-w-0 bg-mw-bg p-4"><h1 className="mb-4 text-lg font-semibold">저장된 표 보기</h1>
      <SavedViewsController boardId={sample.board.id} boardSource={sample.board.source} orgId="visual-org" currentUserId="visual-user"
        columns={sample.columns} rows={sample.rows} groups={sample.groups} renderMode="flat" canonicalNewLead
        canEditItems canBulkEditItems canMoveRows canDeleteItems memberOptions={[{ id: "review-user", label: "가상 담당자" }]} />
    </main>;
  }
  if (params.surface === "consultation") return <VisualConsultationProbe />;
  if (params.surface === "companies") return <VisualCompaniesProbe />;
  if (params.surface === "document-ocr") return <VisualDocumentOcrProbe />;
  if (params.surface === "notifications") {
    return <main className="min-h-screen bg-mw-bg p-4"><NotificationCenterFixture /></main>;
  }
  if (params.surface === "account-profile") {
    return (
      <main data-visual-account-profile className="min-h-screen bg-mw-bg p-6">
        <div className={accountStyles.page}>
          <header className={accountStyles.heading}>
            <h1>내 계정과 팀</h1>
            <p>내 정보와 지금 함께 일하는 회사를 확인해요.</p>
          </header>
          <AccountHub
            account={{
              displayName: "가상 사용자",
              loginEmail: "masked@example.invalid",
              initial: "가",
              workspaceName: "가상 회사",
              roleLabel: "팀장",
              roleDescription: "팀장으로 참여하고 있어요.",
              scopeLabel: "부서 이하 전체",
              scopeNote: "이 값은 회사의 권한 설정이에요. 일부 화면의 부서 범위 적용은 계속 보강 중이에요.",
              canManageCompany: false,
            }}
            orgProfile={{
              title: { kind: "ready", value: "고객 운영 담당" },
              department: { kind: "ready", value: "고객지원팀" },
              job: { kind: "ready", value: "고객 요청을 분류하고 다음 담당자에게 연결해요." },
              reportsTo: { kind: "ready", value: "가상 관리자" },
            }}
            workspaces={[{
              orgId: "visual-org",
              name: "가상 회사",
              slug: "visual-company",
              role: "team_lead",
              status: "active",
              deletionRequestedAt: null,
            }]}
          />
        </div>
      </main>
    );
  }
  // #640 — 「보는 방식 네 갈래」를 1440·375 에서 눈으로 확인하는 자리.
  // reporting=unknown 을 붙이면 «보고 예외를 못 읽은» 상태도 볼 수 있다.
  if (params.surface === "organization-views") {
    const model = loadVisualOrgViewModel({ reportingKnown: params.reporting !== "unknown" });
    return (
      <main data-visual-org-views-fixture data-build-sha={process.env.MOAWORK_BUILD_SHA ?? "local"} className="min-h-screen bg-mw-bg p-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <header>
            <h1 className="text-xl font-semibold">우리 회사와 팀</h1>
            <p className="mt-1 text-sm text-zinc-500">가상 회사에서 조직관리 보는 방식을 확인해요.</p>
          </header>
          <OrgViewTabs
            model={model}
            /* 실제 화면과 «같은 규칙» 으로 갈래를 정한다 — role 만 있는 주소는 권한 갈래다.
               그래야 「권한표의 역할 링크가 전체 재적재를 일으켜도 갈래가 유지되는가」를
               픽스처에서 그대로 잴 수 있다(PR #641 검수 P1-2). */
            initialView={isOrgView(params.view) ? params.view : params.role ? "perm" : "list"}
            /* ★ 안 넘기면 기본값 null = «못 읽음» 이라 「자리 목록을 다 못 읽었어요」 배너가
                 사진에 영구히 박힌다 — 아무것도 실패하지 않았는데.
                 그리고 「경영지원 팀장」이 «공석» 으로 떠서, 게이트가 이 화면의 핵심 배지를
                 처음으로 눈으로 보게 된다. 그게 안 보여서 #640 · #683 이 두 번 미끄러졌다. */
            seatDefinitions={loadVisualSeatDefinitions()}
            departmentSlot={<p className="text-xs text-zinc-500">— 부서 관리 자리(실제 화면에서는 조직도 관리가 들어옵니다)</p>}
            permissionSlot={
              <div className="text-xs text-zinc-500">
                <p>— 권한 자리(실제 화면에서는 권한표와 개인별 편집기가 들어옵니다)</p>
                {/* 권한표의 역할 링크와 «같은 모양» — 평범한 a 태그라 전체 재적재를 일으킨다. */}
                <a href="?surface=organization-views&role=admin" data-role="admin" className="mt-2 inline-block underline">
                  역할 바꾸기(관리자) — 전체 재적재
                </a>
              </div>
            }
          />
        </div>
      </main>
    );
  }
  if (params.surface === "organization") {
    const chart = await loadVisualDepartmentChart();
    return (
      <main data-visual-department-fixture data-build-sha={process.env.MOAWORK_BUILD_SHA ?? "local"} className="min-h-screen bg-mw-bg p-6">
        <div className="mx-auto max-w-6xl">
          <header className="mb-4">
            <h1 className="text-xl font-semibold">우리 회사와 팀</h1>
            <p className="mt-1 text-sm text-zinc-500">가상 회사에서 조직도 관리 흐름을 확인해요.</p>
          </header>
          <DepartmentManager
            chart={chart}
            canManage
            actions={{
              create: visualCreateDepartmentAction,
              rename: visualRenameDepartmentAction,
              move: visualMoveDepartmentAction,
              assign: visualAssignDepartmentMemberAction,
            }}
          />
        </div>
      </main>
    );
  }
  const tab = params.tab === "contact" ? "contact" : "new";
  const mutation = typeof params.mutation === "string" ? params.mutation : "none";
  const layer = params.layer === "workspace" ? "workspace" : "none";
  const theme = params.theme === "dark" ? "dark" : params.theme === "light" ? "light" : null;
  const jar = await cookies();
  const saved = jar.get(`visual-workflow-${tab}-saved`)?.value ?? null;
  const draft = jar.get(`visual-workflow-${tab}-draft`)?.value ?? null;
  const error = jar.get(`visual-workflow-${tab}-error`)?.value ?? null;
  const data = fixture(tab, draft ?? saved, params.groups === "all");
  return (
    <main data-visual-fixture={tab} data-build-sha={process.env.MOAWORK_BUILD_SHA ?? "local"} className={`visual-mutation-${mutation} min-h-screen max-w-full bg-mw-bg p-4`}>
      <IconSprite />
      <VisualThemeProbe theme={theme} />
      <VisualAppearanceProbe accent={tab} controls={params.appearance === "controls"} />
      <style>{`
        .visual-mutation-settings-bottom [data-visual-block='board-settings'] { order: 99 !important; margin-top: 700px !important; }
        .visual-mutation-split-scroll [data-board-table-format='uniform'] { overflow: auto !important; }
        .visual-mutation-no-sticky [data-right-pinned='true'] { position: static !important; }
        .visual-mutation-wrong-region [data-right-pinned='true'] { right: 36% !important; }
        .visual-mutation-overlap [data-visual-block='board-settings'] { transform: translateY(-48px) !important; }
      `}</style>
      <VisualLayerProbe />
      {layer === "workspace" ? <VisualWorkspaceSwitcherProbe /> : null}
      <output data-visual-workflow-feedback className="sr-only" aria-live="polite">{error ?? (saved ? "저장됨" : "")}</output>
      <BoardWorkspace
        {...data}
        columnOrder={{}}
        cellFlash={error ? { itemId: "visual-item", errors: [{ key: "work_move", label: "업무이동", message: error }] } : null}
        assigneeLabels={{ "visual-user": "카위", "review-user": "이대표", "ops-team": "심사실행팀 3명" }}
        memberDirectory={[
          { id: "review-user", label: "이대표", title: "영업본부장", groupId: "sales", groupLabel: "영업본부", active: true },
          { id: "visual-user", label: "카위", title: "콜 담당", groupId: "support", groupLabel: "경영지원팀", active: true },
          { id: "ops-team", label: "박정화", title: "실장", groupId: "review", groupLabel: "심사실행팀", active: true },
          { id: "reviewer-2", label: "김도윤", title: "심사역", groupId: "review", groupLabel: "심사실행팀", active: true },
          { id: "sales-2", label: "정희", title: "실장", groupId: "sales", groupLabel: "영업본부", active: true },
        ]}
        canEditItems
        canManageColumns
        currentUserId="visual-user"
        settingsSlot={<VisualSettingsSlot />}
        onboardingSlot={tab === "new" ? <NewLeadOnboarding key="issue-554-help" /> : undefined}
        cellAction={visualSetCellAction}
        itemDetailFixture={tab === "new" ? {
          ok: true,
          viewerId: "visual-user",
          members: [
            { id: "review-user", name: "이대표" },
            { id: "visual-user", name: "카위" },
            { id: "ops-team", name: "심사실행팀 3명" },
          ],
          files: [],
          links: [],
          cloudFolder: {
            id: "visual-cloud-folder",
            url: "https://drive.google.com/drive/folders/example-folder",
            provider: "google_drive",
            providerLabel: "Google Drive",
          },
          events: [
            { id: "event-1", kind: "memo", body: "1차 통화 예정. @정희 실장님 제조업 쪽 자료 있으면 공유 부탁드립니다.", actor_id: "review-user", created_at: "2026-08-25T05:00:00.000Z" },
            { id: "event-2", kind: "call", body: "대표님 부재. 비서분이 내일 오전 재통화 요청.", actor_id: "review-user", created_at: "2026-08-24T07:40:00.000Z" },
            { id: "event-3", kind: "field_change", body: "상담 상황을 상담 전으로 바꿈 · 이대표", actor_id: null, created_at: "2026-08-23T08:22:00.000Z" },
            /* #662 — 같은 사람(review-user)이 네 성격을 다 남긴 모습. 아바타는 넷 다 같고 배지만 다르다. */
            { id: "event-4", kind: "admin", body: "사업자등록증 사본 접수. 법인 인감증명서는 다음 주 발급 예정.", actor_id: "review-user", created_at: "2026-08-22T02:10:00.000Z" },
            { id: "event-5", kind: "meeting", body: "본사 방문 미팅 40분. 설비 증설 계획과 자금 일정 확인.", actor_id: "review-user", created_at: "2026-08-21T06:30:00.000Z" },
          ],
        } : undefined}
        workflowTransitionSlot={tab === "contact" ? (
          <form action={visualSetCellAction} className="mt-4 flex justify-end gap-2">
            <input type="hidden" name="boardId" value="visual-contact" />
            <input type="hidden" name="value" value="업무관리 이동" />
            <button type="submit" className="h-10 rounded-lg bg-mw-primary px-4 text-sm font-semibold text-mw-on-accent">계약업체 실무로 넘기기</button>
          </form>
        ) : undefined}
      />
    </main>
  );
}
