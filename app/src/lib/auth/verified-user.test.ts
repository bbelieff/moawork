import { describe, expect, it } from "vitest";
import { getVerifiedAuthUser } from "./verified-user";

function client(result: { data: { claims: object } | null; error: unknown }) {
  return { auth: { getClaims: async () => result } };
}

describe("Issue 857 — 토큰 서명으로 확인한 사람", () => {
  it("서명이 확인된 토큰의 사람·이메일·표시 정보를 돌려준다", async () => {
    const user = await getVerifiedAuthUser(client({
      data: { claims: { sub: "user-1", email: "member@example.test", user_metadata: { name: "구성원" } } },
      error: null,
    }));
    expect(user).toEqual({ id: "user-1", email: "member@example.test", user_metadata: { name: "구성원" } });
  });

  it("확인에 실패하거나 사람이 없는 토큰(익명 키)은 로그인하지 않은 것으로 본다", async () => {
    expect(await getVerifiedAuthUser(client({ data: null, error: new Error("invalid JWT") }))).toBeNull();
    expect(await getVerifiedAuthUser(client({ data: { claims: { role: "anon" } }, error: null }))).toBeNull();
    expect(await getVerifiedAuthUser(client({ data: { claims: { sub: "" } }, error: null }))).toBeNull();
  });

  it("확인 중 예상 밖 예외(깨진 토큰·지원 안 하는 서명 방식)도 로그인하지 않은 것으로 닫는다 — 500 이 아니다", async () => {
    const throwing = { auth: { getClaims: async () => { throw new SyntaxError("Unexpected token in JSON"); } } };
    expect(await getVerifiedAuthUser(throwing)).toBeNull();
    const rejecting = { auth: { getClaims: () => Promise.reject(new Error("Invalid alg claim")) } };
    expect(await getVerifiedAuthUser(rejecting)).toBeNull();
  });

  it("이메일·표시 정보가 없거나 모양이 틀리면 비워 둔다", async () => {
    const user = await getVerifiedAuthUser(client({ data: { claims: { sub: "user-2", email: "", user_metadata: ["x"] } }, error: null }));
    expect(user).toEqual({ id: "user-2", email: null, user_metadata: {} });
  });
});
