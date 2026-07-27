import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AutomationPresetPanel } from "./AutomationPresetPanel";
import { HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS, QUARANTINED_AUTOMATIONS } from "./catalogue";

const unavailable = { kind: "unavailable" as const, message: "hosted 010 RPC를 기다리고 있어요." };

describe("AutomationPresetPanel", () => {
  it("shows 11 deidentified disabled drafts and 8 quarantined items", () => {
    const html = renderToStaticMarkup(<AutomationPresetPanel availability={unavailable} />);
    expect(HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS).toHaveLength(11);
    expect(QUARANTINED_AUTOMATIONS).toHaveLength(8);
    expect(html.match(/활성화 준비 중/g)).toHaveLength(11);
    expect(html).toContain("격리한 항목");
    expect(html).not.toContain("http");
    expect(html).not.toContain("@example");
  });

  it("keeps every preset disabled and without an automatic apply action", () => {
    const html = renderToStaticMarkup(<AutomationPresetPanel availability={unavailable} />);
    expect(html).toContain("disabled=\"\"");
    expect(html).not.toContain("자동 적용");
    expect(HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS.every((draft) => draft.state === "draft_disabled")).toBe(true);
  });
});
