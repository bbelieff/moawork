import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AutomationPresetPanel } from "./AutomationPresetPanel";
import { HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS, QUARANTINED_AUTOMATIONS } from "./catalogue";

const snapshot = { boards: [], builder: null, automations: [], readError: "read failed" } as const;

describe("AutomationPresetPanel", () => {
  it("renders all draft and quarantine catalogue entries", () => {
    const html = renderToStaticMarkup(<AutomationPresetPanel snapshot={snapshot} />);
    expect(HIGH_CONFIDENCE_STATUS_TO_GROUP_DRAFTS).toHaveLength(11);
    expect(QUARANTINED_AUTOMATIONS).toHaveLength(8);
    expect(html).toContain("read failed");
    expect(html).not.toContain("http");
  });
  it("disables mutations when its server snapshot failed", () => {
    const html = renderToStaticMarkup(<AutomationPresetPanel snapshot={snapshot} />);
    expect(html).toContain("disabled=\"\"");
  });
});
