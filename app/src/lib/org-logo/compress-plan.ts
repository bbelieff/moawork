/**
 * 로고를 «얼마나 줄일까» 를 정한다 (#652).
 *
 * ## 왜 자동으로 줄이나
 *
 * 총괄 지시 — 「아무리 로고라고 해도 용량제한은 너무 빡빡하다. 용량제한은 조금 더
 * 여유있게 해주고 자동압축을 해서 권장에 맞춰주는 기능을 넣어줘」
 *
 * 로고는 사이드바에서 **32px**, 설정 카드에서 **56px** 로 보인다. 그런데 사람이 가진 파일은
 * 보통 인쇄용이라 2000px · 3MB 다. **줄이라고 시키는 대신 앱이 줄이면 된다** —
 * 사용자가 「이미지 편집기를 열어 크기를 줄이는」 일을 하게 만들지 않는다.
 *
 * ## 왜 화면 밖인가
 *
 * 실제 축소는 canvas 가 하지만 «얼마나 줄일지» 는 순수 계산이다.
 * 컴포넌트 안에 두면 검사할 자리가 없어진다(#638). 여기는 DOM 을 모른다 — 숫자만 받고 돌려준다.
 */

/** 사용자가 «올릴 수 있는» 크기. 넉넉하게 둔다 — 줄이는 건 앱이 한다. */
export const ORG_LOGO_ACCEPT_BYTES = 16 * 1024 * 1024;

/** 줄인 뒤 «목표» 크기. 이보다 작으면 더 건드리지 않는다. */
export const ORG_LOGO_TARGET_BYTES = 320 * 1024;

/** 긴 변이 이보다 크면 줄인다. 32~56px 로 보이는 그림에 2000px 은 필요 없다. */
export const ORG_LOGO_TARGET_EDGE = 512;

export type CompressPlan =
  | { kind: "as_is"; reason: "small_enough" | "vector" | "unknown_size" }
  | { kind: "resize"; width: number; height: number; quality: number };

/**
 * 줄일지, 얼마나 줄일지.
 *
 * ★ SVG 는 «건드리지 않는다». 벡터라 크기를 줄여도 파일이 안 작아지고,
 *   canvas 로 다시 그리면 벡터가 픽셀이 되어 오히려 나빠진다.
 * ★ 이미 작으면 그대로 둔다. 멀쩡한 파일을 다시 인코딩하면 «더 커지는» 일도 생긴다.
 */
export function planLogoCompression(input: {
  mime: string;
  bytes: number;
  width: number;
  height: number;
}): CompressPlan {
  if (input.mime === "image/svg+xml") return { kind: "as_is", reason: "vector" };

  const { width, height } = input;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { kind: "as_is", reason: "unknown_size" };
  }

  const longEdge = Math.max(width, height);
  const overSized = longEdge > ORG_LOGO_TARGET_EDGE;
  const overWeight = input.bytes > ORG_LOGO_TARGET_BYTES;
  if (!overSized && !overWeight) return { kind: "as_is", reason: "small_enough" };

  // 비율을 지킨다. 로고가 찌그러지면 그건 압축이 아니라 훼손이다.
  const scale = overSized ? ORG_LOGO_TARGET_EDGE / longEdge : 1;
  return {
    kind: "resize",
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    // JPEG 만 품질이 의미 있다. PNG 는 무손실이라 이 값을 무시한다.
    quality: 0.88,
  };
}

/**
 * 줄인 결과를 «쓸지» 정한다.
 *
 * ★ 줄였는데 더 커졌으면 원본을 쓴다. 실제로 일어난다 —
 *   사진이 아닌 단색 로고를 JPEG 로 다시 인코딩하면 커지는 경우가 있다.
 */
export function shouldUseCompressed(originalBytes: number, compressedBytes: number): boolean {
  return compressedBytes > 0 && compressedBytes < originalBytes;
}

/** 사람에게 보여 줄 크기. 「180KB」처럼 읽히게. */
export function formatLogoBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
