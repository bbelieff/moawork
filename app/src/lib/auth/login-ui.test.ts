import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    expect(page).toContain("하나의 워크스페이스");
    expect(page).toContain("모든 업무 흐름의 중심");
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
