import Link from "next/link";
import styles from "./account.module.css";

type Kind = "empty" | "error" | "denied" | "blocked";

export function AccountState({
  kind,
  title,
  message,
  actionHref,
  actionLabel,
}: {
  kind: Kind;
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <section
      className={`${styles.state} ${kind === "error" || kind === "denied" ? styles.blocked : ""}`}
      role={kind === "error" || kind === "denied" ? "alert" : "status"}
      aria-labelledby={`account-state-${kind}`}
    >
      <h2 id={`account-state-${kind}`}>{title}</h2>
      <p>{message}</p>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className={styles.primaryAction}>
          {actionLabel}
        </Link>
      ) : null}
    </section>
  );
}
