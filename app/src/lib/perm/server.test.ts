import { describe, expect, it } from "vitest";
import { permAccessReasonFromRpcError } from "./server";

describe("permAccessReasonFromRpcError — 권한 없음과 장애를 구분한다 (BBE-90 과 같은 규약)", () => {
  it("42501(insufficient_privilege) 은 permission", () => {
    expect(permAccessReasonFromRpcError({ code: "42501" })).toBe("permission");
  });

  it("그 외 에러 코드는 unavailable", () => {
    expect(permAccessReasonFromRpcError({ code: "PGRST202" })).toBe("unavailable");
    expect(permAccessReasonFromRpcError({ code: "42883" })).toBe("unavailable");
  });

  it("에러 코드가 없거나 null 이어도 unavailable(닫힘)로 수렴한다", () => {
    expect(permAccessReasonFromRpcError(null)).toBe("unavailable");
    expect(permAccessReasonFromRpcError(undefined)).toBe("unavailable");
    expect(permAccessReasonFromRpcError({})).toBe("unavailable");
  });
});
