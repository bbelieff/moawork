import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POLICYFUND_STRUCTURE_PACK } from "./policyfund-pack";

const MIGRATION_040 = join(process.cwd(), "..", "supabase", "migrations", "040_preset_depersonalize.sql");

function legacyPack() {
  const sql = readFileSync(MIGRATION_040, "utf8");
  const start = sql.indexOf("$json$");
  const end = sql.lastIndexOf("$json$");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return JSON.parse(sql.slice(start + "$json$".length, end)) as Record<string, unknown>;
}

function mappingPayload(pack: Record<string, unknown>) {
  const payload = { ...pack };
  delete payload.key;
  delete payload.source;
  return payload;
}

describe("Monday mapping source integrity (BBE-156)", () => {
  it("keeps every board, column, option, section, view, type, and rule from the historical mapping", () => {
    expect(mappingPayload(JSON.parse(JSON.stringify(POLICYFUND_STRUCTURE_PACK)))).toEqual(
      mappingPayload(legacyPack()),
    );
  });

  it("keeps the original customer evidence as an explicitly non-exclusive source", () => {
    const originalSource = String(legacyPack().source);
    expect(POLICYFUND_STRUCTURE_PACK.source).toContain("실측 출처");
    expect(POLICYFUND_STRUCTURE_PACK.source).toContain("특정 고객 전용 팩이 아님");
    expect(POLICYFUND_STRUCTURE_PACK.source).toContain(originalSource);
  });

  it("uses neutral mapping filenames and exported identifiers", () => {
    const files = readdirSync(__dirname);
    expect(files.filter((file) => /seoul/i.test(file))).toEqual([]);
    for (const file of files.filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(join(__dirname, file), "utf8");
      expect(source, file).not.toMatch(/\bSEOUL_[A-Z0-9_]+\b/);
    }
  });
});
