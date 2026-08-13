import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decideModeDestination,
  decideUserModeDestination,
} from "@/lib/mode/contract";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("./mode-page.module.css", import.meta.url), "utf8");

describe("mode chooser presentation contract", () => {
  it("keeps both choices as explicit POST actions with accessible descriptions", () => {
    expect(pageSource).toContain('action="/mode/preference" method="post"');
    expect(pageSource).toContain('name="mode" value="platform"');
    expect(pageSource).toContain('name="mode" value="user"');
    expect(pageSource).toContain('role="group" aria-labelledby="mode-title"');
    expect(pageSource).toContain('aria-labelledby="platform-mode-title"');
    expect(pageSource).toContain('aria-describedby="platform-mode-description"');
    expect(pageSource).toContain('aria-labelledby="user-mode-title"');
    expect(pageSource).toContain('aria-describedby="user-mode-description"');
  });

  it("uses visible interactive and keyboard focus styling", () => {
    expect(pageSource).toContain("styles.platformChoice");
    expect(pageSource).toContain("styles.userChoice");
    expect(styleSource).toContain("cursor: pointer");
    expect(styleSource).toContain(".choice:focus-visible");
    expect(styleSource).toContain("@media (max-width: 680px)");
  });

  it("explains a signing-config failure as a readable notice, not a dead end", () => {
    expect(pageSource).toContain('role="status"');
    expect(pageSource).toContain("styles.notice");
    expect(pageSource).toContain("이 선택을 기억해 두는 기능이 잠시 꺼져 있어요");
    expect(styleSource).toContain(".notice");
  });

  it("explains both outcomes without internal workspace language", () => {
    expect(pageSource).toContain("관리자 페이지 열기");
    expect(pageSource).toContain("릴리스 상태와 데모 회사를 확인해요.");
    expect(pageSource).toContain("회사 업무로 가기");
    expect(pageSource).toContain(
      "회사 업무 흐름으로 돌아가며, 가입한 회사 수에 따라 바로 열거나 선택·연결해요.",
    );
    expect(pageSource).toContain("회사 접근 권한을 새로 만들지 않아요.");
    expect(pageSource).not.toMatch(/워크스페이스|조직/);
  });

  it("matches the user-mode copy to zero, one, and multiple company outcomes", () => {
    const one = [{ orgId: "org-1", slug: "first-company" }];
    expect(
      decideModeDestination({
        preference: null,
        platformAccess: "granted",
        memberships: [],
      }).kind,
    ).toBe("chooser");
    expect(
      decideModeDestination({
        preference: "platform",
        platformAccess: "granted",
        memberships: [],
      }).kind,
    ).toBe("platform");
    expect(decideUserModeDestination([]).kind).toBe("entry");
    expect(decideUserModeDestination(one).kind).toBe("workspace");
    expect(
      decideUserModeDestination([
        ...one,
        { orgId: "org-2", slug: "second-company" },
      ]).kind,
    ).toBe("workspaces");
  });
});
