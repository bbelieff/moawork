import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { CONTACT_TAB, NEW_LEAD_TAB } from "@/lib/default-tabs";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import { VisualSettingsSlot } from "./VisualSettingsSlot";
import { NewLeadOnboarding } from "@/components/board/NewLeadOnboarding";
import { cookies } from "next/headers";
import { visualSetCellAction } from "./actions";
import { VisualLayerProbe } from "./VisualLayerProbe";
import { VisualWorkspaceSwitcherProbe } from "./VisualWorkspaceSwitcherProbe";

function fixture(tabKey: string, workflowValue: string | null) {
  const definition = tabKey === "contact" ? CONTACT_TAB : NEW_LEAD_TAB;
  const board = {
    id: `visual-${definition.key}`, org_id: "visual-org", name: definition.name,
    description: definition.description, icon: definition.icon, is_system: false,
    source: definition.source, sort_order: 0, created_by: "visual-user", created_at: "", updated_at: "",
  } satisfies Board;
  const groups = definition.groups.slice(0, 1).map((group, index) => ({
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
  const row = {
    id: "visual-item", org_id: board.org_id, board_id: board.id, group_id: groups[0]?.id ?? null,
    title: tabKey === "new" ? "(주)대한정밀" : "마스킹된 예시 항목", assigned_to: tabKey === "new" ? "review-user" : null, deal_id: tabKey === "new" ? "visual-deal" : null, sort_order: 0,
    created_at: "", updated_at: "", values,
  } satisfies ItemWithValues;
  return { board, groups, columns, rows: [row] };
}

export default async function VisualFixturePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const tab = params.tab === "contact" ? "contact" : "new";
  const mutation = typeof params.mutation === "string" ? params.mutation : "none";
  const layer = params.layer === "workspace" ? "workspace" : "none";
  const jar = await cookies();
  const saved = jar.get(`visual-workflow-${tab}-saved`)?.value ?? null;
  const draft = jar.get(`visual-workflow-${tab}-draft`)?.value ?? null;
  const error = jar.get(`visual-workflow-${tab}-error`)?.value ?? null;
  const data = fixture(tab, draft ?? saved);
  return (
    <main data-visual-fixture={tab} data-build-sha={process.env.VERCEL_GIT_COMMIT_SHA ?? "local"} className={`visual-mutation-${mutation} min-h-screen max-w-full bg-mw-bg p-4`}>
      <style>{`
        .visual-mutation-settings-bottom [data-visual-block='board-settings'] { order: 99 !important; margin-top: 700px !important; }
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
