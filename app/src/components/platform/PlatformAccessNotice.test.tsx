import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlatformAccessNotice } from "./PlatformAccessNotice";

describe("PlatformAccessNotice", () => {
  it("distinguishes a permission denial from a platform service failure", () => {
    const forbidden = renderToStaticMarkup(<PlatformAccessNotice error="platform-forbidden" />);
    const unavailable = renderToStaticMarkup(<PlatformAccessNotice error="platform-unavailable" />);

    expect(forbidden).toContain("관리자 모드를 사용할 권한이 없어요");
    expect(forbidden).not.toContain("응답하지 않았습니다");
    expect(unavailable).toContain("관리자 권한을 확인하지 못했어요");
    expect(unavailable).toContain("잠시 후");
  });

  it("renders nothing for unknown or legacy query values", () => {
    expect(renderToStaticMarkup(<PlatformAccessNotice error="platform" />)).toBe("");
    expect(renderToStaticMarkup(<PlatformAccessNotice error={undefined} />)).toBe("");
  });
});
