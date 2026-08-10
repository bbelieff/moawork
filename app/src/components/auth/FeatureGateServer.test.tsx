import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FEATURES } from "@/lib/product";

const mocks = vi.hoisted(() => ({ loadLockedFeatures: vi.fn() }));

// server.ts 는 "server-only" 를 import 하므로 테스트에서는 모듈째 갈아끼운다.
// (판정 규칙 자체의 단위 테스트는 lib/entitlements/resolve.test.ts 가 소유한다.)
vi.mock("@/lib/entitlements/server", () => ({
  loadLockedFeatures: mocks.loadLockedFeatures,
}));

import { FeatureGateServer } from "./FeatureGateServer";

const LOCK_TEXT = "현재 플랜에서 잠긴 기능입니다";

async function render(props: Parameters<typeof FeatureGateServer>[0]) {
  return renderToStaticMarkup(await FeatureGateServer(props));
}

describe("FeatureGateServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("엔타이틀먼트 행이 없는 신규 조직에서도 본문을 그대로 보여준다", async () => {
    // P0 회귀 가드 — 승인 직후 회사(= org_entitlements 행 없음 · LocalRepo 인메모리에도
    // 없는 실 UUID)에 대표가 들어갔을 때 화면이 잠금 한 줄로 붕괴하던 사고.
    mocks.loadLockedFeatures.mockResolvedValue([]);

    const html = await render({
      orgId: "9f1d0c7a-0000-4000-8000-000000000001",
      feature: FEATURES.dash,
      label: "대시보드(core.dash)",
      children: <p>대시보드 본문</p>,
    });

    expect(html).toContain("대시보드 본문");
    expect(html).not.toContain(LOCK_TEXT);
  });

  it("판정을 서버 소스에 위임한다 — 조직 id 와 기능키를 그대로 넘긴다", async () => {
    // getRepo()(항상 LocalRepo 인메모리) 로 되돌아가면 이 계약이 깨진다.
    mocks.loadLockedFeatures.mockResolvedValue([]);

    await render({
      orgId: "org-42",
      feature: FEATURES.dash,
      children: <p>본문</p>,
    });

    expect(mocks.loadLockedFeatures).toHaveBeenCalledWith("org-42", [
      FEATURES.dash,
    ]);
  });

  it("명시적으로 잠긴 기능만 잠금 안내로 대체한다", async () => {
    mocks.loadLockedFeatures.mockResolvedValue([FEATURES.notify]);

    const html = await render({
      orgId: "org-1",
      feature: FEATURES.notify,
      label: "알림(mod.notify)",
      children: <p>알림 본문</p>,
    });

    expect(html).toContain(LOCK_TEXT);
    expect(html).toContain("알림(mod.notify)");
    expect(html).not.toContain("알림 본문");
  });

  it("label 이 없으면 기능키를 그대로 쓴다", async () => {
    mocks.loadLockedFeatures.mockResolvedValue([FEATURES.hometax]);

    const html = await render({
      orgId: "org-1",
      feature: FEATURES.hometax,
      children: <p>본문</p>,
    });

    expect(html).toContain(FEATURES.hometax);
  });

  it("fallback 이 있으면 잠금 안내 대신 fallback 을 쓴다", async () => {
    mocks.loadLockedFeatures.mockResolvedValue([FEATURES.notify]);

    const html = await render({
      orgId: "org-1",
      feature: FEATURES.notify,
      children: <p>본문</p>,
      fallback: <p>대체 화면</p>,
    });

    expect(html).toContain("대체 화면");
    expect(html).not.toContain(LOCK_TEXT);
  });
});
