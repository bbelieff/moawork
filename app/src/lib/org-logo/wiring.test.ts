import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ★ 왜 «소스를 읽는» 테스트인가 (BBE-199)
//
// 이 저장소가 반복하는 병은 「부품은 다 만들어 놓고 배선을 안 한다」다.
// BBE-199 착수 시점의 상태가 정확히 그랬다 —
//   WorkspaceMark 는 signedImageUrl 을 받아 그리고 이니셜로 폴백까지 하고,
//   WorkspaceSwitcher 는 그것을 회사명 왼쪽에 두고 있는데,
//   layout.tsx 가 `signedImageUrl: null` 로 «하드코딩» 해서 끊어 놨다.
// 그 상태에서도 부품 단위 테스트는 전부 초록이었다. 끊긴 선을 아무도 안 봤기 때문이다.
//
// 행위 테스트로 잡으려면 레이아웃 서버 컴포넌트 전체를 세워야 해서 비용이 크다.
// 그래서 «배선이 살아 있는지» 만 소스에서 직접 확인한다. 완벽한 검사는 아니지만,
// 이 저장소가 실제로 밟은 실패 형태를 정확히 겨냥한다.

const appRoot = resolve(process.cwd(), "src", "app", "(app)");
const layout = readFileSync(resolve(appRoot, "layout.tsx"), "utf8");
const membersPage = readFileSync(resolve(appRoot, "settings", "members", "page.tsx"), "utf8");

describe("사이드바 배선 — 회사 로고가 스위처까지 도달한다", () => {
  it("★ layout 이 로고 URL 을 실제로 불러온다", () => {
    expect(layout).toContain("loadOrgLogoSignedUrls");
  });

  it("★ signedImageUrl 을 null 로 하드코딩하지 않는다 — 이것이 끊긴 배선의 모습이었다", () => {
    expect(layout).not.toMatch(/signedImageUrl:\s*null/u);
    expect(layout).toMatch(/signedImageUrl:\s*orgLogoUrls\.get\(/u);
  });
});

describe("계정설정 › 회사와 팀 배선 — 업로드 화면이 붙어 있다", () => {
  it("★ 회사와 팀 화면이 로고 카드를 렌더한다", () => {
    expect(membersPage).toContain("OrgLogoCard");
    expect(membersPage).toContain("loadOrgLogoView");
  });

  it("★ 관리 권한을 서버가 판정해 내려준다 — 화면이 스스로 정하지 않는다", () => {
    expect(membersPage).toMatch(/canManage=\{isManager\(ctx\.role\)\}/u);
  });
});
