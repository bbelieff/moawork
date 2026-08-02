"use client";

// T07 · 어깨너머 방지 마스킹 표시 + [전체보기] 1클릭.
//
// 기본은 가린 값이고, 버튼 한 번으로 원문이 보인다.
// ⚠ 이건 **표시 계층**이다 — 원문은 이미 클라이언트에 와 있다. 진짜 감춰야 하는 값은
//    서버에서 아예 내려보내지 않아야 한다(고객 업무 데이터가 그 경우다).
//    여기서 다루는 건 운영자가 볼 권한이 있는 계약 상대 정보뿐이다.

import { useState } from "react";
import styles from "./platform.module.css";

export function MaskedValue({
  masked,
  full,
  label,
}: {
  masked: string;
  full: string | null;
  /** 스크린리더용 항목명 — "사업자등록번호 전체보기" 처럼 읽힌다. */
  label: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const canReveal = full !== null && full.length > 0 && full !== masked;

  return (
    <span className={styles.masked}>
      {revealed && canReveal ? full : masked}
      {canReveal ? (
        <button
          type="button"
          className={styles.revealButton}
          onClick={() => setRevealed((v) => !v)}
          aria-label={`${label} ${revealed ? "가리기" : "전체보기"}`}
        >
          {revealed ? "가리기" : "전체보기"}
        </button>
      ) : null}
    </span>
  );
}
