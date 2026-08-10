/* eslint-disable @next/next/no-img-element */
import Link from "next/link";

// 인증된 셸 전용 브랜드 마크(BBE-116). `Logo`(MoaWork 자체 브랜드)는 로그인 전
// 화면들이 쓰고 여기서는 건드리지 않는다 — 로그인 전엔 아직 "회사"가 없으므로
// MoaWork 마크가 맞고, 로그인 후엔 그 회사의 마크가 맞다(둘은 다른 개념).
//
// 회사 로고는 orgs.logo_url(선택 필드, 회사 설정에서 채운다)에서 온다.
// 값이 없으면 회사 이름 텍스트로 대체한다 — 지금은 모든 회사가 이 상태다.

type Props = {
  orgName: string;
  logoUrl?: string | null;
  href: string;
  height?: number;
  className?: string;
};

function isSafeLogoUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function WorkspaceBrand({ orgName, logoUrl, href, height = 30, className }: Props) {
  const safeLogoUrl = logoUrl && isSafeLogoUrl(logoUrl) ? logoUrl : null;
  return (
    <Link href={href} className={className} aria-label={`${orgName} 홈`}>
      {safeLogoUrl ? (
        <img
          src={safeLogoUrl}
          alt={`${orgName} 로고`}
          height={height}
          style={{ height, width: "auto", maxWidth: 160 }}
        />
      ) : (
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.01em" }}>{orgName}</span>
      )}
    </Link>
  );
}
