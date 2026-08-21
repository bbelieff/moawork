import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { deletionConfirmationMatches, WorkspaceManagementPanel, type ManagedWorkspace } from "./WorkspaceManagementPanel";

const row = (role: ManagedWorkspace["role"], status: ManagedWorkspace["status"] = "active"): ManagedWorkspace => ({
  orgId: `${role}-${status}`,
  name: `${role} 회사`,
  slug: `${role}-workspace`,
  role,
  status,
  deletionRequestedAt: status === "pending_delete" ? "2026-08-22T01:00:00Z" : null,
});

describe("WorkspaceManagementPanel", () => {
  it("shows deletion controls only to active owners and explains other roles", () => {
    const html = renderToStaticMarkup(<WorkspaceManagementPanel workspaces={[row("owner"), row("admin"), row("member")]} />);
    expect(html.match(/회사 삭제 예약/g)).toHaveLength(2);
    expect(html.match(/현재 대표만 요청/g)).toHaveLength(2);
    expect(html).toContain("disabled");
  });

  it("requires the exact workspace name without trimming or case folding", () => {
    expect(deletionConfirmationMatches("Seoul 회사", "Seoul 회사")).toBe(true);
    expect(deletionConfirmationMatches("Seoul 회사", "seoul 회사")).toBe(false);
    expect(deletionConfirmationMatches("Seoul 회사", "Seoul 회사 ")).toBe(false);
  });

  it("keeps pending-delete rows visible only as a narrow restore surface", () => {
    const html = renderToStaticMarkup(<WorkspaceManagementPanel workspaces={[row("owner", "pending_delete")]} />);
    expect(html).toContain("삭제 예정 · 데이터는 보존 중");
    expect(html).toContain("삭제 예정 되돌리기");
    expect(html).not.toContain("회사 삭제 예약");
  });

  it("renders RPC failure explicitly instead of an empty-company state", () => {
    const html = renderToStaticMarkup(<WorkspaceManagementPanel workspaces={[]} loadError />);
    expect(html).toContain("회사 목록을 불러오지 못했어요");
    expect(html).toContain("회사가 없는 상태가 아니에요");
    expect(html).not.toContain("접근 가능한 회사가 없어요");
  });
});
