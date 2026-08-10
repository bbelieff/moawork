"use client";

import styles from "@/components/account/account.module.css";

export default function AccountError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1>내 계정과 팀</h1>
      </header>
      <section className={`${styles.state} ${styles.blocked}`} role="alert">
        <h2>계정 정보를 불러오지 못했어요</h2>
        <p>바뀐 내용은 없어요. 잠시 뒤 다시 확인해 주세요.</p>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={() => unstable_retry()}
        >
          다시 불러오기
        </button>
      </section>
    </div>
  );
}
