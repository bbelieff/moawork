import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STAGE_BOARDS } from "@/lib/crm/stageBoards";
import { PlatformDemoWorkspaceShell } from "./PlatformDemoWorkspaceShell";

const data = { board: STAGE_BOARDS[0], columns: [], total: 0, companyById: new Map(), sourceKind: "supabase" as const };
const importCsv = async () => ({ ok: true, message: "완료" });

describe("PlatformDemoWorkspaceShell", () => {
  it("renders the complete user-workspace chrome with CSV in its toolbar", () => {
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceShell activeScreen="dashboard" data={data} importCsv={importCsv} />);
    expect(html).toContain("데모 사용자 워크스페이스");
    expect(html).toContain("대시보드(core.dash)");
    expect(html).toContain("CSV 가져오기");
    expect(html).toContain("데모 워크스페이스 메뉴");
  });

  it("opens CRM content from the workspace navigation", () => {
    const html = renderToStaticMarkup(<PlatformDemoWorkspaceShell activeScreen="newcust" data={data} importCsv={importCsv} />);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("단계가 아직 없습니다");
    expect(html).toContain("/platform/demo?screen=contract&amp;crm=contract");
  });
});

