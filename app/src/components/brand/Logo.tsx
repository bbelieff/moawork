/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/product";

// 브랜드 로고 — design-tokens.md §4·§5.
// light/dark 두 자산을 함께 렌더하고 CSS(.mw-only-light/.mw-only-dark)로 전환한다.
// 서버 컴포넌트에서 쓰이고 테마 전환에 리렌더가 필요 없다(깜빡임 없음).
//
// 사용 규칙(§5): 락업 최소 너비 120px · 심볼 최소 16px.
// 모듈 순서·각도·간격 변경 금지, 그라데이션·그림자·회전 금지.
// next/image 대신 <img> 를 쓰는 이유: SVG 는 래스터 최적화 대상이 아니고,
// 두 자산을 CSS 로 토글하므로 로더를 거칠 필요가 없다.

type Props = {
  /** 렌더 높이(px). 락업 기본 30 — 목업 v0.3 사이드바 기준. */
  height?: number;
  className?: string;
  /** 지정하면 로고 전체가 안전한 홈 링크가 된다. */
  href?: string;
};

export function Logo({ height = 30, className, href }: Props) {
  const mark = (
    <span aria-label={`${PRODUCT_NAME} 로고`} role="img">
      <img
        src="/brand/moawork-lockup-light.svg"
        alt=""
        height={height}
        style={{ height, width: "auto", minWidth: 120 }}
        className="mw-only-light"
      />
      <img
        src="/brand/moawork-lockup-dark.svg"
        alt=""
        height={height}
        style={{ height, width: "auto", minWidth: 120 }}
        className="mw-only-dark"
      />
    </span>
  );

  return href ? (
    <Link href={href} className={className} aria-label={`${PRODUCT_NAME} 홈`} title="홈">
      {mark}
    </Link>
  ) : (
    <span className={className}>{mark}</span>
  );
}

export function Symbol({ height = 24, className }: Omit<Props, "href">) {
  return (
    <span className={className} aria-label={`${PRODUCT_NAME} 심볼`} role="img">
      <img
        src="/brand/moawork-symbol-light.svg"
        alt=""
        height={height}
        style={{ height, width: "auto", minWidth: 16 }}
        className="mw-only-light"
      />
      <img
        src="/brand/moawork-symbol-dark.svg"
        alt=""
        height={height}
        style={{ height, width: "auto", minWidth: 16 }}
        className="mw-only-dark"
      />
    </span>
  );
}
