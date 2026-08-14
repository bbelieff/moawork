import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productionFiles = [
  new URL("../../app/(app)/page.tsx", import.meta.url),
  new URL("./server.ts", import.meta.url),
  new URL("./service.ts", import.meta.url),
];

describe("dashboard production repository boundary", () => {
  it("has no implicit LocalRepo/getRepo fallback in the production call graph", () => {
    for (const file of productionFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file.pathname).not.toMatch(/\bgetRepo\s*\(/);
      expect(source, file.pathname).not.toMatch(/\bLocalRepo\b/);
    }
  });
});
