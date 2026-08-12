import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HEADER = "/** 이것은 서울경영 먼데이 원본이다. 제품 기본 구조가 아니다. 정본은 docs/design/UI목업_워크스페이스_최종_v6.html. */\n";
const ORIGINAL_SHA256: Record<string, string> = {
  "seoul-newcust.ts": "ed3da8958e34d810564a8d77c48d68b4b9fa10ebf1bfc1e5fa47d2bf1e283d8c",
  "seoul-contact.ts": "6eafb8eba4d96dc6cb0fd6bc4805774bbae85f654529f9a6b8e86d3ca2903749",
  "seoul-work.ts": "d6733855995e8799040907299a0f1eeca0525a3ad9f71b2c32efcdc4881b61c3",
  "seoul-pack.ts": "43d80f43eff3a775c897a0a94be9160924a8a9ef0d7b048a08fabb45464ccbfa",
};

describe("Monday mapping source integrity (BBE-156)", () => {
  for (const [file, expected] of Object.entries(ORIGINAL_SHA256)) {
    it(`${file} keeps the origin/main payload unchanged`, () => {
      const source = readFileSync(join(__dirname, file), "utf8").replace(/\r\n/g, "\n");
      expect(source.startsWith(HEADER)).toBe(true);
      expect(createHash("sha256").update(source.slice(HEADER.length)).digest("hex")).toBe(expected);
    });
  }
});
