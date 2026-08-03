import { describe, expect, it } from "vitest";
import { parseNewcustCsv } from "./csv";

describe("parseNewcustCsv", () => {
  it("keeps quoted commas in a company name", () => expect(parseNewcustCsv('업체명,연락처\n"모아, 기업",02-1')) .toEqual([["업체명", "연락처"], ["모아, 기업", "02-1"]]));
  it("supports escaped quotes and CRLF", () => expect(parseNewcustCsv('업체명\r\n"모아 ""기업"""\r\n')[1]?.[0]).toBe('모아 "기업"'));
  it("rejects an unterminated quote", () => expect(() => parseNewcustCsv('업체명\n"모아')).toThrow("따옴표"));
});
