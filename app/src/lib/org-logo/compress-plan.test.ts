import { describe, expect, it } from "vitest";
import {
  formatLogoBytes,
  ORG_LOGO_ACCEPT_BYTES,
  ORG_LOGO_TARGET_BYTES,
  ORG_LOGO_TARGET_EDGE,
  planLogoCompression,
  shouldUseCompressed,
} from "./compress-plan";
import { ORG_LOGO_MAX_BYTES } from "./contracts";

/**
 * #652 — 「용량제한은 조금 더 여유있게 해주고 자동압축을 해서 권장에 맞춰주는 기능을 넣어줘」
 *
 * 여기서 막지 않으면 «줄인다면서 찌그러뜨리거나», «벡터를 픽셀로 만들거나»,
 * «줄였는데 더 커진 것을 그대로 올리는» 일이 생긴다.
 */

const plan = (o: Partial<Parameters<typeof planLogoCompression>[0]>) =>
  planLogoCompression({ mime: "image/png", bytes: 100, width: 100, height: 100, ...o });

describe("#652 상한은 여유 있게", () => {
  it("★ 올릴 수 있는 크기가 서버 상한보다 넉넉하다 — 줄이는 건 앱이 한다", () => {
    expect(ORG_LOGO_ACCEPT_BYTES).toBeGreaterThan(ORG_LOGO_MAX_BYTES);
    expect(ORG_LOGO_ACCEPT_BYTES).toBeGreaterThanOrEqual(8 * 1024 * 1024);
  });

  it("목표 크기는 상한보다 «한참» 작다 — 목표가 상한과 같으면 압축할 이유가 없다", () => {
    expect(ORG_LOGO_TARGET_BYTES).toBeLessThan(ORG_LOGO_MAX_BYTES / 2);
  });
});

describe("#652 줄일지 말지", () => {
  it("★ SVG 는 건드리지 않는다 — 벡터를 픽셀로 만들면 오히려 나빠진다", () => {
    expect(plan({ mime: "image/svg+xml", bytes: 5_000_000, width: 4000, height: 4000 })).toEqual({
      kind: "as_is",
      reason: "vector",
    });
  });

  it("이미 작고 작으면 그대로 둔다 — 멀쩡한 파일을 다시 인코딩하지 않는다", () => {
    expect(plan({ bytes: 12_000, width: 256, height: 256 })).toEqual({
      kind: "as_is",
      reason: "small_enough",
    });
  });

  it("크기를 모르면 손대지 않는다 — 모르는 채로 줄이면 찌그러진다", () => {
    expect(plan({ width: 0, height: 0 })).toEqual({ kind: "as_is", reason: "unknown_size" });
    expect(plan({ width: Number.NaN, height: 100 })).toEqual({ kind: "as_is", reason: "unknown_size" });
  });

  it("긴 변이 크면 줄인다", () => {
    const result = plan({ bytes: 3_000_000, width: 2048, height: 2048 });
    expect(result).toEqual({ kind: "resize", width: 512, height: 512, quality: 0.88 });
  });

  it("★ 비율을 지킨다 — 로고가 찌그러지면 압축이 아니라 훼손이다", () => {
    const result = plan({ bytes: 3_000_000, width: 2000, height: 1000 });
    expect(result).toEqual({ kind: "resize", width: 512, height: 256, quality: 0.88 });
  });

  it("작지만 «무거우면» 다시 인코딩한다 — 크기는 그대로 둔다", () => {
    const result = plan({ bytes: ORG_LOGO_TARGET_BYTES + 1, width: 200, height: 120 });
    expect(result).toEqual({ kind: "resize", width: 200, height: 120, quality: 0.88 });
  });

  it("긴 변 기준값 바로 아래는 그대로 둔다", () => {
    expect(plan({ bytes: 1000, width: ORG_LOGO_TARGET_EDGE, height: 10 })).toEqual({
      kind: "as_is",
      reason: "small_enough",
    });
  });

  it("아주 납작해도 최소 1px 은 남는다", () => {
    const result = plan({ bytes: 3_000_000, width: 4000, height: 1 });
    expect(result).toEqual({ kind: "resize", width: 512, height: 1, quality: 0.88 });
  });
});

describe("#652 줄인 것을 «쓸지»", () => {
  it("작아졌으면 쓴다", () => {
    expect(shouldUseCompressed(1_000_000, 180_000)).toBe(true);
  });

  it("★ 더 커졌으면 원본을 쓴다 — 단색 로고를 다시 인코딩하면 커지기도 한다", () => {
    expect(shouldUseCompressed(50_000, 80_000)).toBe(false);
    expect(shouldUseCompressed(50_000, 50_000)).toBe(false);
  });

  it("빈 결과는 쓰지 않는다", () => {
    expect(shouldUseCompressed(50_000, 0)).toBe(false);
  });
});

describe("#652 사람에게 보여 줄 크기", () => {
  it("읽히는 단위로 적는다", () => {
    expect(formatLogoBytes(512)).toBe("512B");
    expect(formatLogoBytes(180 * 1024)).toBe("180KB");
    expect(formatLogoBytes(3.2 * 1024 * 1024)).toBe("3.2MB");
  });

  it("모르는 값은 «모른다» 고 적는다", () => {
    expect(formatLogoBytes(Number.NaN)).toBe("—");
    expect(formatLogoBytes(-1)).toBe("—");
  });
});
