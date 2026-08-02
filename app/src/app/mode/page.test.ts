import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("states that the mode choice does not grant membership or authority", () => {
    expect(pageSource).toContain("이 선택은 화면 모드만 바꾸며 멤버십이나 권한을 새로 만들지 않아요.");
  });
});
