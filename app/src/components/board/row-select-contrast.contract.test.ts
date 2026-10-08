import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/boards/status-palette";

/**
 * #845 8단계(2026-10-08) — 행 고르기 체크의 테두리는 행 바탕과 3:1 이상(WCAG 1.4.11 비텍스트 대비).
 * globals.css 의 실제 color-mix 비율과 실제 토큰 값으로 잰다(문자열 존재만 보지 않는다).
 */
const globals = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = globals.indexOf(`\n${selector} {`);
  expect(start, `${selector} 블록`).toBeGreaterThanOrEqual(0);
  return globals.slice(start, globals.indexOf("\n}", start));
}

function token(css: string, name: string): string {
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(css);
  expect(match, name).not.toBeNull();
  return match![1];
}

/** color-mix(in srgb, a p%, b) — sRGB 채널을 그대로 섞는다. */
function mix(a: string, b: string, percent: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const p = percent / 100;
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(a, i) * p + channel(b, i) * (1 - p)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function checkboxMix(state: "" | ":hover"): number {
  const rule = new RegExp(
    `input\\[type="checkbox"\\]\\[data-row-select\\]${state.replace(":", "\\:")} \\{[^}]*?` +
      `(?:border|border-color):[^;]*color-mix\\(in srgb, var\\(--mw-fg\\) (\\d+)%, var\\(--mw-card\\)\\)`,
  );
  const match = rule.exec(globals);
  expect(match, `체크 테두리 규칙${state}`).not.toBeNull();
  return Number(match![1]);
}

describe("행 고르기 체크 — 비텍스트 대비 3:1", () => {
  const themes = {
    light: block(":root"),
    dark: block('[data-theme="dark"]'),
  };

  for (const [theme, css] of Object.entries(themes)) {
    it(`${theme}: 평소·호버 테두리가 카드·앱 바탕·행 호버 바탕과 3:1 이상`, () => {
      const fg = token(css, "--mw-fg");
      const card = token(css, "--mw-card");
      const backgrounds = {
        card,
        bg: token(css, "--mw-bg"),
        // --mw-row-hover: color-mix(in srgb, var(--mw-record) 5%, var(--mw-card)), --mw-record = --mw-work-blue.
        rowHover: mix(token(css, "--mw-work-blue"), card, 5),
      };
      for (const state of ["", ":hover"] as const) {
        const border = mix(fg, card, checkboxMix(state));
        for (const [name, background] of Object.entries(backgrounds)) {
          expect(contrastRatio(border, background), `${theme} ${state || "평소"} vs ${name}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }

  it("차분함 유지 — 평소 테두리는 글자색 그대로가 아니다(호버가 더 진하다)", () => {
    expect(checkboxMix("")).toBeLessThan(checkboxMix(":hover"));
    expect(checkboxMix(":hover")).toBeLessThan(100);
  });
});
