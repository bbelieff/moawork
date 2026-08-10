import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_TEMPLATE_CODES, templateCodeFor } from "./triggers";

describe("message trigger templates", () => {
  it("keeps simple absence 1-5 separate from malicious absence", () => {
    const simple = Array.from({ length: 5 }, (_, index) => templateCodeFor(`간편 부재 ${index + 1}회` as keyof typeof DEFAULT_MESSAGE_TEMPLATE_CODES));
    expect(new Set(simple).size).toBe(5);
    expect(simple).not.toContain(templateCodeFor("악성 부재"));
  });
});
