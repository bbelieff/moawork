import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8").replace(/\r\n/gu, "\n");

// page.tsx is a Server Component. A function created here cannot be serialized to a
// Client Component prop; the kanban switch failed to load this way (#747).
describe("board page server-to-client props", () => {
  it("stays a Server Component", () => {
    expect(source).not.toMatch(/^\s*["']use client["']/mu);
  });

  it("never passes an inline function as a JSX prop", () => {
    const inline = source.match(/\b[A-Za-z][\w]*=\{\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>/gu) ?? [];
    const functions = source.match(/\b[A-Za-z][\w]*=\{\s*(?:async\s+)?function\b/gu) ?? [];
    expect([...inline, ...functions]).toEqual([]);
  });

  it("binds the kanban column rename to its server action", () => {
    expect(source).toMatch(/onSave=\{renameColumnTitleAction\.bind\(null,\s*id,\s*c\.id\)\}/u);
  });
});
