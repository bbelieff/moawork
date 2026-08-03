import { describe, expect, it } from "vitest";
import { NewcustCutoverConflictError } from "@/lib/repo/supabase/supabaseCrmSource";
import { toErrorResponse } from "./http";

describe("toErrorResponse cutover", () => {
  it("cutover domain error만 409로 변환한다", async () => {
    const response = toErrorResponse(new NewcustCutoverConflictError());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "신규업체 이관이 완료되어 기존 CRM 원본은 읽기 전용입니다." });
  });
  it("일반 오류는 500을 유지한다", () => expect(toErrorResponse(new Error("db")).status).toBe(500));
});
