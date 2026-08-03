import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("platform demo workspace mutations", () => {
  it("revalidates the server-side selection and never accepts an org id from the browser", () => {
    expect(actions).toContain("loadPlatformDemoTabContext()");
    expect(actions).toContain("state.tenantAccess !== \"active-membership\"");
    expect(actions).toContain("p_org_id: context.orgId");
    expect(actions).not.toContain('formData.get("orgId")');
  });

  it("wires CSV directly into the CRM model behind the selected demo boundary", () => {
    expect(page).toContain("<PlatformDemoCrm");
    expect(page).toContain("importCsv={importPlatformDemoCrmCsv}");
    expect(page).not.toContain("BuilderWorkspaceSurface");
    expect(actions).toContain('"platform_import_selected_demo_crm_csv"');
    expect(actions).toContain("p_request_id: requestId");
    expect(actions).not.toContain('client.from("deals").insert');
    expect(page).toContain('"platform_get_selected_demo_crm"');
    expect(page).not.toContain("loadOwnerWorkspaceOpsSnapshotForOrg");
    expect(page).toContain('kind: "access-required"');
  });
});
