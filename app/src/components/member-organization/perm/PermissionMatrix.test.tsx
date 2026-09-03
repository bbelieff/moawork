import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PERM_ITEM_COUNT } from "@/lib/perm/matrix";
import { PermissionMatrix, type PermissionMatrixAccess } from "./PermissionMatrix";
import type { PermMatrixSnapshot } from "@/lib/perm/server";

function baseSnapshot(overrides: Partial<PermMatrixSnapshot> = {}): PermMatrixSnapshot {
  return {
    matrix: [],
    exceptions: [],
    ...overrides,
  };
}

function allowedAccess(snapshot: PermMatrixSnapshot = baseSnapshot()): PermissionMatrixAccess {
  return { kind: "allowed", snapshot };
}

describe("PermissionMatrix — 권한 없음과 장애를 다른 화면으로 보여준다", () => {
  it("permission 거부는 소유자·관리자 안내를 보여준다", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix
        orgId="org-1"
        activeRole="member"
        viewerRole="member"
        access={{ kind: "denied", reason: "permission" }}
      />,
    );
    expect(html).toContain("대표와 관리자만");
    expect(html).not.toContain("불러오지 못했어요");
  });

  it("unavailable 은 장애 안내를 보여준다 — permission 문구와 다르다", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix
        orgId="org-1"
        activeRole="member"
        viewerRole="owner"
        access={{ kind: "denied", reason: "unavailable" }}
      />,
    );
    expect(html).toContain("불러오지 못했어요");
    expect(html).not.toContain("대표와 관리자만");
  });
});

describe("PermissionMatrix — 매트릭스 렌더", () => {
  it("24항목이 전부 렌더된다", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix orgId="org-1" activeRole="member" viewerRole="owner" access={allowedAccess()} />,
    );
    const matches = html.match(/data-scope-key="/g) ?? [];
    expect(matches).toHaveLength(PERM_ITEM_COUNT);
  });

  it("소유자 탭은 토글이 비활성이다 — 소유자 권한은 끌 수 없다", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix orgId="org-1" activeRole="owner" viewerRole="owner" access={allowedAccess()} />,
    );
    expect(html).toContain("대표 권한은 끌 수 없어요");
    // owner 행의 버튼은 전부 disabled
    const ownerRowButtons = html.match(/<button[^>]*disabled[^>]*aria-pressed/g) ?? [];
    expect(ownerRowButtons.length).toBeGreaterThan(0);
  });

  it("소유자가 아닌 뷰어는 편집할 수 없다는 안내를 보여준다", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix orgId="org-1" activeRole="member" viewerRole="admin" access={allowedAccess()} />,
    );
    expect(html).toContain("보기 전용이에요");
    // admin 뷰어이므로 24항목 전부 비활성이어야 한다
    const enabledButtons = html.match(/<button type="submit"(?!\s+disabled)[^>]*aria-pressed/g) ?? [];
    expect(enabledButtons).toHaveLength(0);
  });

  it("소유자 뷰어는 소유자 아닌 역할 탭에서 토글을 조작할 수 있다(비활성 아님)", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix orgId="org-1" activeRole="member" viewerRole="owner" access={allowedAccess()} />,
    );
    expect(html).not.toContain("보기 전용이에요");
  });

  it("역할 기본값을 서버 스냅샷이 있으면 스냅샷 값으로, 없으면 matrix.ts 기본값으로 렌더한다", () => {
    const snapshot = baseSnapshot({
      matrix: [
        {
          group: "위험",
          scopeKey: "danger.csv_export",
          label: "CSV 내보내기",
          danger: true,
          allowed: { owner: true, admin: false, team_lead: false, member: false },
        },
      ],
    });
    const html = renderToStaticMarkup(
      <PermissionMatrix orgId="org-1" activeRole="admin" viewerRole="owner" access={allowedAccess(snapshot)} />,
    );
    // 오버라이드로 admin=false 가 됐으므로 CSV 내보내기 행은 off 상태여야 한다
    //
    // ★ 2026-08-26 — 예전에는 `class="tg off"` 를 봤다. 그건 **목업 스타일시트의 클래스**이고
    //   앱 CSS 에는 없는 이름이라, 이 단언은 «화면에 아무것도 안 보이는 상태» 를 통과시키고 있었다.
    //   실제로 운영에서 토글이 통째로 안 보였는데 이 테스트는 초록이었다.
    //   이제 «스타일» 이 아니라 «의미» 를 잰다 — 스타일을 바꿔도 이 단언은 계속 옳다.
    const rowMatch = html.match(/data-scope-key="danger\.csv_export"[\s\S]*?<\/form>/);
    expect(rowMatch?.[0]).toContain('aria-pressed="false"');
    expect(rowMatch?.[0]).toContain("꺼짐");
  });

  it("개인 예외 건수를 항목별로 보여준다", () => {
    const snapshot = baseSnapshot({
      exceptions: [
        { userId: "u1", scopeKey: "work.item_delete", decision: "allow", accessLevel: "editor" },
        { userId: "u2", scopeKey: "work.item_delete", decision: "deny", accessLevel: "viewer" },
      ],
    });
    const html = renderToStaticMarkup(
      <PermissionMatrix orgId="org-1" activeRole="member" viewerRole="owner" access={allowedAccess(snapshot)} />,
    );
    expect(html).toContain("개인 예외 2건 적용 중");
  });

  it("역할 탭 4개가 모두 렌더되고 활성 탭에 aria-current 가 붙는다", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix orgId="org-1" activeRole="team_lead" viewerRole="owner" access={allowedAccess()} />,
    );
    expect(html).toContain('data-role="owner"');
    expect(html).toContain('data-role="admin"');
    expect(html).toContain('data-role="team_lead"');
    expect(html).toContain('data-role="member"');
    expect(html).toContain('data-role="team_lead" aria-current="true"');
  });
});
