import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewcustSnapshot } from "@/lib/repo/supabase/supabaseBoardsSource";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/newcust/actions", () => {
  const action = async () => ({ ok: false, message: "" });
  return { addNewcustColumn: action, addNewcustGroup: action, createNewcustItem: action, deleteNewcustColumn: action, importNewcustCsv: action, renameNewcustColumn: action, renameNewcustGroup: action, saveNewcustView: action, undoNewcustCsv: action, updateNewcustCell: action, updateNewcustItem: action };
});

const snapshot: NewcustSnapshot = {
  board: { id: "b1", org_id: "o1", name: "신규업체", description: null, icon: null, is_system: true, source: "newcust.monday.v1", sort_order: 0, created_by: "u1", created_at: "", updated_at: "" },
  groups: [{ id: "g1", org_id: "o1", board_id: "b1", name: "신규 문의", color: "#579bfc", sort_order: 0 }],
  columns: [{ id: "c1", org_id: "o1", board_id: "b1", key: "company_name", label: "회사명", type: "text", options_jsonb: null, sort_order: 0, width: 160 }],
  items: [],
  views: [],
};

describe("NewcustBoard direct-edit permission contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders owner/board-owner inline group, row, column, and cell entry points", async () => {
    const { NewcustBoard } = await import("./NewcustBoard");
    const html = renderToStaticMarkup(<NewcustBoard snapshot={snapshot} currentUserId="u1" currentUserName="Owner" canManageStructure />);
    expect(html).toContain("새 업체 추가 옵션");
    expect(html).toContain("그룹 이름 변경");
    expect(html).toContain("컬럼 제목 인라인 변경");
    expect(html).toContain("신규 문의에 업체 추가");
    expect(html).toContain("컬럼 추가");
  });

  it("renders a reason and disables structure affordances for a non-owner member", async () => {
    const { NewcustBoard } = await import("./NewcustBoard");
    const html = renderToStaticMarkup(<NewcustBoard snapshot={snapshot} currentUserId="u2" currentUserName="Member" canManageStructure={false} />);
    expect(html).toContain("보드 구조 변경은 보드 소유자 또는 관리자만 가능합니다");
    expect(html).toContain("보드 소유자 또는 관리자만 컬럼을 추가할 수 있습니다");
    expect(html).toContain("disabled");
  });
});
