import { describe, expect, it } from "vitest";
import { parseEffectivePermissions, parseScopedWorkItems, permAccessReasonFromRpcError } from "./server";

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

describe("parseScopedWorkItems", () => {
  it("숨김 건수와 허용 item id를 검증한다", () => {
    expect(parseScopedWorkItems({ itemIds: ["a", "b"], hiddenCount: 3 }))
      .toEqual({ itemIds: ["a", "b"], hiddenCount: 3 });
  });

  it("형식이 틀리면 fail closed 한다", () => {
    expect(parseScopedWorkItems({ itemIds: [1], hiddenCount: 0 })).toBeNull();
    expect(parseScopedWorkItems({ itemIds: [], hiddenCount: -1 })).toBeNull();
  });
});

describe("parseEffectivePermissions", () => {
  const scopes = ["work.view_tabs", "work.item_upsert"];

  it("요청한 모든 판정이 boolean일 때만 batch를 수용한다", () => {
    expect(parseEffectivePermissions({ "work.view_tabs": true, "work.item_upsert": false }, scopes))
      .toEqual({ "work.view_tabs": true, "work.item_upsert": false });
  });

  it("partial, extra, malformed 응답은 전부 fail closed 한다", () => {
    expect(parseEffectivePermissions({ "work.view_tabs": true }, scopes)).toBeNull();
    expect(parseEffectivePermissions({ "work.view_tabs": true, "work.item_upsert": false, extra: true }, scopes)).toBeNull();
    expect(parseEffectivePermissions({ "work.view_tabs": true, "work.item_upsert": null }, scopes)).toBeNull();
  });
});
