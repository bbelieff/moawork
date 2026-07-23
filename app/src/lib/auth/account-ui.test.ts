import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("account shell role boundary", () => {
  it("sidebar가 raw Ctx 역할 대신 fail-closed account presentation을 사용한다", () => {
    const source = readFileSync(
      new URL("../../app/(app)/layout.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("{account.roleLabel} · {account.scopeLabel}");
    expect(source).not.toContain("roleLabel(ctx.role)");
    expect(source).not.toContain("scopeLabel(ctx.scope)");
  });
});
