import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./nav-items";
import { APP_TABS } from "./app-tabs";

describe("BBE-142 — 6탭이 사이드바에서 전부 연결돼 있다", () => {
  it("APP_TABS 의 canonicalHref 6개 전부 NAV_ITEMS 에 연결된 href 로 존재한다", () => {
    const navHrefs = new Set(NAV_ITEMS.map((item) => item.href).filter(Boolean));
    for (const tab of APP_TABS) {
      expect(navHrefs.has(tab.canonicalHref!), `${tab.key}(${tab.canonicalHref}) 가 사이드바에 없다`).toBe(true);
    }
  });

  it("프리셋 라이브러리가 새로 연결됐다 — 착수 전엔 대응 주소가 없었다", () => {
    const preset = NAV_ITEMS.find((item) => item.key === "preset");
    expect(preset?.href).toBe("/presets");
  });
});
