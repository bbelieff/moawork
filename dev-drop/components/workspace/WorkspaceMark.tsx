// 회사 표식(아이콘) — 3단 폴백
//   ① 업로드 이미지  ② 이니셜 + 회사명 해시 자동색  ③ (호출부에서) 기본 심볼
//
// 색은 브랜드 v1.0 팔레트 안에서만 뽑는다. People Coral(#F26B5E)은
// 담당자·멘션·알림 전용이므로 회사 표식에 쓰지 않는다.
//
// 작성: MWC(코워크).

import styles from "./workspace-switcher.module.css";

/** 브랜드 v1.0 계열만 사용. Coral 제외. */
const MARK_TONES = [
  "toneBlue",
  "toneTeal",
  "toneViolet",
  "toneBlueDeep",
  "toneTealDeep",
  "toneVioletDeep",
] as const;

type Props = {
  name: string;
  iconUrl: string | null;
  size?: number;
  /** 요청 대기 등 비활성 표현 */
  muted?: boolean;
};

export function WorkspaceMark({ name, iconUrl, size = 32, muted = false }: Props) {
  const initial = toInitial(name);
  const tone = MARK_TONES[hashCode(name) % MARK_TONES.length];
  const className = [styles.mark, styles[tone], muted ? styles.markMuted : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={className}
      style={{ width: size, height: size, flexBasis: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- 서명 URL(외부 도메인·짧은 만료)이라 next/image 최적화 대상 아님
        <img src={iconUrl} alt="" className={styles.markImg} loading="lazy" decoding="async" />
      ) : (
        initial
      )}
    </span>
  );
}

/**
 * 법인 형태 표기 — 이니셜에서 제외한다.
 * 안 걸러내면 "(주)엘에스"·"주식회사 모아"가 전부 "주"로 보여 서로 구분이 안 된다.
 * (MWC 단위테스트에서 발견한 실제 결함)
 */
const LEGAL_FORM = /(\(주\)|\(유\)|\(재\)|\(사\)|㈜|㈕|주식회사|유한회사|유한책임회사|재단법인|사단법인|합자회사|합명회사)/g;

/** 한글 1자 / 영문 2자. 법인 표기·이모지·특수문자는 건너뛴다. */
export function toInitial(name: string): string {
  const stripped = name.replace(LEGAL_FORM, " ").trim();
  // 법인 표기를 걷어냈더니 아무것도 안 남으면 원본으로 되돌린다.
  const source = stripped.length > 0 ? stripped : name;

  const cleaned = Array.from(source).filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  if (cleaned.length === 0) return "?";

  const first = cleaned[0];
  if (/[가-힣]/.test(first)) return first; // 한글 완성형
  return cleaned.slice(0, 2).join("").toUpperCase();
}

/** 회사명 → 안정적인 색 배정용 해시(결정적, 서버·클라이언트 동일 결과). */
export function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
