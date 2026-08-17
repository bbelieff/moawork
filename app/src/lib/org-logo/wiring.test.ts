import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSwitcherWorkspaces } from "./switcher";

// ★ 왜 «소스를 읽는» 테스트인가 (BBE-199)
//
// 이 저장소가 반복하는 병은 「부품은 다 만들어 놓고 배선을 안 한다」다.
// 착수 시점에 정확히 그랬다 — WorkspaceMark 는 signedImageUrl→이니셜 폴백까지
// 구현돼 있고 WorkspaceSwitcher 는 회사명 왼쪽에 두고 있는데, layout.tsx 가
// `signedImageUrl: null` 로 하드코딩해 끊어 놨다. 부품 테스트는 전부 초록이었다.
//
// ★★ 이 파일의 1차 버전은 «자기가 겨냥한 병에 자기가 걸렸다» (DC-16 지적).
//   `expect(layout).toContain("loadOrgLogoSignedUrls")` 가 **import 줄에도 매치**해서,
//   import 를 남기고 값만 항상 비게 만드는 변이를 통과시켰다. 사이드바 로고 영구 사망인데 초록.
//   → 「이름이 파일에 있는가」가 아니라 «값이 흐르는가» 를 봐야 한다.
//   그래서 ⓐ import 줄을 걷어내고 ⓑ 로더 «호출 결과가 묶인 이름» 을 뽑아
//   ⓒ 그 이름이 실제로 스위처 입력으로 흘러가는지까지 따라간다.

const appRoot = resolve(process.cwd(), "src", "app", "(app)");
const layoutSource = readFileSync(resolve(appRoot, "layout.tsx"), "utf8").replace(/\r\n/gu, "\n");
const membersPage = readFileSync(resolve(appRoot, "settings", "members", "page.tsx"), "utf8").replace(/\r\n/gu, "\n");

/** import 줄을 걷어낸 «본문». 이름이 import 에만 있어도 통과하는 일을 막는다. */
const layoutBody = layoutSource
  .split("\n")
  .filter((line) => !/^\s*import\b/u.test(line))
  .join("\n");

describe("사이드바 배선 — 로고 URL이 «값으로» 스위처까지 도달한다", () => {
  it("★ 로더 호출이 본문에 있다 (import 줄만으로는 통과하지 못한다)", () => {
    expect(layoutBody).toMatch(/await\s+loadOrgLogoSignedUrls\s*\(/u);
  });

  it("★ 로더 결과가 «이름에 묶이고» 그 이름이 스위처 입력으로 흘러간다", () => {
    // 로더 호출 결과가 묶인 변수 이름을 뽑는다.
    const binding = layoutBody.match(/const\s+(\w+)\s*=[^;]*await\s+loadOrgLogoSignedUrls\s*\(/u);
    expect(binding, "로더 호출 결과가 어떤 이름에도 묶여 있지 않다").not.toBeNull();
    const name = binding![1];

    // 그 «바로 그 이름» 이 스위처 입력을 만드는 자리로 전달돼야 한다.
    // (다른 빈 Map 을 만들어 끼워 넣는 변이를 여기서 잡는다.)
    const handoff = new RegExp(`buildSwitcherWorkspaces\\s*\\([^)]*\\b${name}\\b`, "u");
    expect(layoutBody, `${name} 이 buildSwitcherWorkspaces 로 전달되지 않는다`).toMatch(handoff);
  });

  it("★ 로더에 실제 멤버십 목록을 넘긴다 (빈 배열로 바꿔치기 금지)", () => {
    expect(layoutBody).toMatch(/loadOrgLogoSignedUrls\s*\(\s*routing\.memberships/u);
  });

  it("★ signedImageUrl 을 null 로 하드코딩하지 않는다 — 이것이 끊긴 배선의 모습이었다", () => {
    expect(layoutBody).not.toMatch(/signedImageUrl:\s*null/u);
  });
});

// ★ 위는 «배선» 을 보고, 아래는 «행위» 를 본다.
//   소스 검사만으로는 결국 문자열이므로, 값이 실제로 옮겨 붙는지는 함수를 돌려서 잰다.
describe("buildSwitcherWorkspaces — 값이 실제로 옮겨 붙는다", () => {
  const memberships = [
    { orgId: "org-a", slug: "a", name: "가 회사", role: "owner" as const },
    { orgId: "org-b", slug: "b", name: "나 회사", role: "member" as const },
  ];

  it("로고가 있는 조직에는 서명 URL 이 붙는다", () => {
    const result = buildSwitcherWorkspaces(memberships, new Map([["org-a", "https://s.invalid/a"]]));
    expect(result[0].signedImageUrl).toBe("https://s.invalid/a");
  });

  it("★ 로고가 없는 조직은 null 이다 — undefined 가 아니라 명시적 null (이니셜 폴백 신호)", () => {
    const result = buildSwitcherWorkspaces(memberships, new Map([["org-a", "https://s.invalid/a"]]));
    expect(result[1].signedImageUrl).toBeNull();
  });

  it("지도가 비면 전부 null 이고, 그래도 워크스페이스는 사라지지 않는다", () => {
    const result = buildSwitcherWorkspaces(memberships, new Map());
    expect(result).toHaveLength(2);
    expect(result.every((w) => w.signedImageUrl === null)).toBe(true);
  });

  it("이름·슬러그·역할을 그대로 옮긴다", () => {
    const [first] = buildSwitcherWorkspaces(memberships, new Map());
    expect(first).toMatchObject({ orgId: "org-a", slug: "a", name: "가 회사", role: "owner", status: "active" });
  });
});

describe("계정설정 › 회사와 팀 배선 — 업로드 화면이 붙어 있다", () => {
  const membersBody = membersPage
    .split("\n")
    .filter((line) => !/^\s*import\b/u.test(line))
    .join("\n");

  it("★ 회사와 팀 화면이 로고 카드를 렌더하고 서버에서 현재 로고를 읽는다", () => {
    expect(membersBody).toMatch(/<OrgLogoCard/u);
    expect(membersBody).toMatch(/loadOrgLogoView\s*\(\s*ctx\.org\.id/u);
  });

  it("★ 관리 권한을 서버가 판정해 내려준다 — 화면이 스스로 정하지 않는다", () => {
    expect(membersBody).toMatch(/canManage=\{isManager\(ctx\.role\)\}/u);
  });

  it("★ 서버가 읽은 로고가 카드로 흘러간다", () => {
    expect(membersBody).toMatch(/<OrgLogoCard[^>]*logo=\{logo\}/u);
  });
});
