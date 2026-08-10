import { describe, expect, it } from "vitest";
import type { InstallResult } from "@/lib/structure-packs";
import { decodePackInstallFlash, encodePackInstallFlash } from "./installFlash";

function result(overrides: Partial<InstallResult> = {}): InstallResult {
  return {
    packKey: "pack.seoul.policyfund1",
    boards: [],
    deferred: [],
    skipped: [],
    ...overrides,
  };
}

describe("installFlash — 설치 결과 인코딩/디코딩", () => {
  it("생성 보드·그룹 합계·건너뜀 수를 왕복한다", () => {
    const installed = result({
      boards: [
        { slug: "newcust", boardId: "b1", nameLabel: "업체명", groupIds: ["g1", "g2"], columnKeys: [], viewIds: [] },
        { slug: "contact", boardId: "b2", nameLabel: "업체명", groupIds: ["g3"], columnKeys: [], viewIds: [] },
      ],
      skipped: ["work"],
    });

    const flash = decodePackInstallFlash(encodePackInstallFlash(installed));
    expect(flash).toEqual({ boards: 2, groups: 3, skipped: 1 });
  });

  it("전량 재설치 skip 은 boards 0 · groups 0 · skipped 3 이다", () => {
    const skipped = result({ skipped: ["newcust", "contact", "work"] });
    expect(decodePackInstallFlash(encodePackInstallFlash(skipped))).toEqual({
      boards: 0,
      groups: 0,
      skipped: 3,
    });
  });

  it("빈 값·형식이 어긋난 값은 null 이다", () => {
    expect(decodePackInstallFlash(undefined)).toBeNull();
    expect(decodePackInstallFlash(null)).toBeNull();
    expect(decodePackInstallFlash("")).toBeNull();
    expect(decodePackInstallFlash("not-json")).toBeNull();
    expect(decodePackInstallFlash(encodeURIComponent(JSON.stringify({ boards: "2" })))).toBeNull();
  });
});
