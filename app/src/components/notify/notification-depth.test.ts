import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./NotificationPanel.tsx", import.meta.url), "utf8");
const worker = readFileSync(
  new URL("../../../../worker/src/index.ts", import.meta.url),
  "utf8",
);

describe("BBE-232 notification depth contract", () => {
  it("keeps action requests unresolved when a user only opens their destination", () => {
    expect(panel).not.toContain("/resolve");
    expect(panel).toContain("DB 트리거가");
    expect(panel).toContain("onClick={() => void go(href, n.target_id ?? n.id)}");
  });

  it("keeps the legacy notification worker provider-stubbed instead of sending externally", () => {
    expect(worker).toContain("providers: defaultProviders()");
    expect(worker).toContain("스텁 — 실제 발송 없음");
  });
});
