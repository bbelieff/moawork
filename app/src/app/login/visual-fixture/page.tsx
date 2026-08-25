import { BoardWorkspace } from "@/components/board/BoardWorkspace";
import { CONTACT_TAB, NEW_LEAD_TAB } from "@/lib/default-tabs";
import type { Board, BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import { VisualSettingsSlot } from "./VisualSettingsSlot";
import { NewLeadOnboarding } from "@/components/board/NewLeadOnboarding";
import { cookies } from "next/headers";
import { visualSetCellAction } from "./actions";
import { VisualLayerProbe } from "./VisualLayerProbe";

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
  const row = {
    id: "visual-item", org_id: board.org_id, board_id: board.id, group_id: groups[0]?.id ?? null,
    title: "마스킹된 예시 항목", assigned_to: null, deal_id: tabKey === "new" ? "visual-deal" : null, sort_order: 0,
    created_at: "", updated_at: "", values: workflowValue ? { [tabKey === "contact" ? "work_move" : "contact_move"]: workflowValue } : {},
  } satisfies ItemWithValues;
  return { board, groups, columns, rows: [row] };
}

export default async function VisualFixturePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const tab = params.tab === "contact" ? "contact" : "new";
  const mutation = typeof params.mutation === "string" ? params.mutation : "none";
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
      <output data-visual-workflow-feedback className="sr-only" aria-live="polite">{error ?? (saved ? "저장됨" : "")}</output>
      <BoardWorkspace
        {...data}
        columnOrder={{}}
        cellFlash={error ? { itemId: "visual-item", errors: [{ key: "work_move", label: "업무이동", message: error }] } : null}
        assigneeLabels={{ "visual-user": "예시 담당자" }}
        canEditItems
        currentUserId="visual-user"
        settingsSlot={<VisualSettingsSlot />}
        onboardingSlot={tab === "new" ? <NewLeadOnboarding key="issue-554-help" /> : undefined}
        cellAction={visualSetCellAction}
      />
    </main>
  );
}
