import styles from "@/components/account/account.module.css";

export default function AccountLoading() {
  return (
    <div className={styles.page} aria-busy="true">
      <header className={styles.heading}>
        <h1>내 계정과 팀</h1>
      </header>
      <div className={`${styles.state} ${styles.skeleton}`} role="status">
        계정 정보를 불러오고 있어요.
      </div>
    </div>
  );
}
