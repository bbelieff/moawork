import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STAGE_BOARDS } from "@/lib/crm/stageBoards";
import { PlatformDemoWorkspaceShell, resolveDemoWorkspaceSelection } from "./PlatformDemoWorkspaceShell";

const data = { board: STAGE_BOARDS[0], columns: [], total: 0, companyById: new Map(), sourceKind: "supabase" as const };
const importCsv = async () => ({ ok: true, message: "완료" });

describe("PlatformDemoWorkspaceShell", () => {
  it("normalizes the single workspace query into a matching screen and board", () => {
    expect(resolveDemoWorkspaceSelection()).toEqual({ screen: "dashboard", boardSlug: "newcust" });
    expect(resolveDemoWorkspaceSelection("newcust")).toEqual({ screen: "newcust", boardSlug: "newcust" });
    expect(resolveDemoWorkspaceSelection("contract")).toEqual({ screen: "contract", boardSlug: "contract" });
    expect(resolveDemoWorkspaceSelection("work")).toEqual({ screen: "work", boardSlug: "work" });
    expect(resolveDemoWorkspaceSelection("bogus")).toEqual({ screen: "dashboard", boardSlug: "newcust" });
  });

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
    expect(html).toContain("/platform/demo?workspace=contract");
    expect(html).not.toContain("crm=");
    expect(html).not.toContain('href="/contract');
    expect(html).not.toContain('href="/newcust');
    expect(html).not.toContain('href="/work');
  });
});
