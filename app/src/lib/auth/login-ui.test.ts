import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUTH_ERROR_MESSAGES } from "./oauth";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const page = read("../../app/(auth)/login/page.tsx");
const styles = read("../../app/(auth)/login/login.module.css");
const button = read("../../components/auth/GoogleSignInButton.tsx");

describe("login A v1.1 UI contract", () => {
  it("브랜드 철학과 업무가 모이는 중심을 표현한다", () => {
    expect(page).toContain("흐름은 단단하게");
    expect(page).toContain("방식은 <em>자유롭게.</em>");
    expect(page).toContain("회사의 모든 업무");
    expect(page).toContain("한곳에서 이어지는 흐름");
  });

  it("로그인 결과와 실패 후 다음 행동을 쉬운 회사 언어로 안내한다", () => {
    expect(page).toContain("로그인하면 권한과 가입한 회사 수를 확인해");
    expect(page).toContain("모드를 고르거나 회사 업무를 시작할 화면으로 이동해요.");

    expect(Object.keys(AUTH_ERROR_MESSAGES).sort()).toEqual([
      "auth",
      "config",
      "membership",
      "profile",
      "provisioning",
    ]);
    const displayEntries = [
      ...page.matchAll(/^\s+(auth|config|membership|profile|provisioning): "([^"]+)",$/gm),
    ];
    const displayErrors = Object.fromEntries(
      displayEntries.map((match) => [match[1], match[2]]),
    );
    expect(Object.keys(displayErrors).sort()).toEqual(
      Object.keys(AUTH_ERROR_MESSAGES).sort(),
    );
    for (const message of Object.values(displayErrors)) {
      expect(message).not.toMatch(/워크스페이스|조직/);
    }
    expect(displayErrors.auth).toContain("다시 시도해 주세요");
    expect(displayErrors.config).toContain("잠시 후 다시 시도해 주세요");
    expect(displayErrors.membership).toContain("초대를 요청해 주세요");
    expect(displayErrors.profile).toContain("다시 로그인해 주세요");
    expect(displayErrors.provisioning).toContain("잠시 후 다시 시도해 주세요");
    expect(page).toContain("const errorMessage = LOGIN_ERROR_MESSAGES[errorCode]");
    expect(page).toContain("{errorMessage}");
    expect(page).not.toMatch(/워크스페이스|조직/);
  });

  it("로그인 패널 우측 상단 브랜드 심볼을 충분한 크기로 보여 준다", () => {
    expect(page).toContain("<Symbol height={26} />");
    expect(styles).toContain("width: 38px");
    expect(styles).toContain("height: 38px");
  });

  it("색상명이 아닌 제품 언어를 사용한다", () => {
    for (const label of ["기록됨", "자동 정리", "한곳에 모임", "함께 진행"]) {
      expect(page).toContain(`label=\"${label}\"`);
    }
    expect(page).not.toContain("Work Blue");
    expect(page).not.toContain("Moa Violet");
  });

  it("로그인 패널을 제목과 연결하고 가짜 정책 링크를 만들지 않는다", () => {
    expect(page).toContain('aria-labelledby="login-title"');
    expect(page).toContain('id="login-title"');
    expect(page).not.toContain("<span>이용약관</span>");
    expect(page).not.toContain("Google OAuth로 안전하게 연결");
    expect(styles).not.toContain(".secure");
  });

  it("Google 버튼은 공식 아이콘과 진행 상태·테마 오류색을 제공한다", () => {
    expect(button).toContain('/brand/google-g.svg');
    expect(button).toContain('provider: "google"');
    expect(button).toContain("aria-busy={pending}");
    expect(button).toContain('aria-live="polite"');
    expect(button).toContain("text-mw-error");
    expect(button).not.toContain("hover:-translate-y-px");
  });

  it("모바일은 로그인 패널을 먼저 보여 주고 수평 단일열을 유지한다", () => {
    expect(styles).toContain("@media (max-width: 980px)");
    expect(styles).toContain("grid-template-columns: 1fr");
    expect(styles).toContain("order: -1");
    expect(styles).toContain("min-height: 100svh");
  });

  it("잔잔한 진입·호흡·hover 모션과 reduced-motion 대안을 함께 제공한다", () => {
    expect(styles).toContain("@keyframes cardReveal");
    expect(styles).toContain("@keyframes coreBreathe");
    expect(styles).toContain("@keyframes flowBreathe");
    expect(styles).toContain(
      "@media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)",
    );
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles.match(/animation: cardReveal[^;]+backwards;/g)).toHaveLength(4);
    expect(button).not.toContain("group-hover:scale");
    expect(button).not.toContain("hover:-translate-y-px");
  });
});
