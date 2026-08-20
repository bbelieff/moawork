import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function methodBody(text: string, signature: string): string {
  const start = text.indexOf(signature);
  expect(start, `${signature} must exist`).toBeGreaterThanOrEqual(0);
  const nextMethod = text.indexOf("\n  }", start);
  expect(nextMethod).toBeGreaterThan(start);
  return text.slice(start, nextMethod);
}

describe("BBE-191 mutation guard", () => {
  it("definition deletion implementations cannot write the value collection", () => {
    const inMemory = methodBody(
      source("./store.ts"),
      "async deleteDef(orgId: string, defId: string)",
    );
    const local = methodBody(
      source("../repo/local/localRepo.ts"),
      "deleteFieldDef(orgId: string, defId: string)",
    );

    expect(inMemory).not.toMatch(/values\.(delete|clear|set)|this\.values\s*=/);
    expect(local).not.toMatch(/fieldValues\s*=|fieldValues\.(splice|pop|shift)/);
  });
});
