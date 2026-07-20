import { describe, it, expect } from "vitest";
import { health } from "./health.js";

describe("health", () => {
  it("ok 상태를 보고한다", () => {
    const h = health(new Date("2026-07-21T00:00:00.000Z"));
    expect(h.ok).toBe(true);
    expect(h.service).toBe("moawork-worker");
    expect(h.ts).toBe("2026-07-21T00:00:00.000Z");
  });
});
