import Link from "next/link";
import styles from "./account.module.css";

export type AccountSection = "account" | "workspace" | "sessions" | "privacy";

type NavItem = {
  key: AccountSection;
  label: string;
  href?: string;
};

export function AccountNav({
  current,
  items,
}: {
  current: AccountSection;
  items: readonly NavItem[];
}) {
  return (
    <nav className={styles.nav} aria-label="내 계정과 팀">
      {items.map((item) =>
        item.href ? (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.key === current ? "page" : undefined}
            className={styles.navLink}
          >
            {item.label}
          </Link>
        ) : (
          <span
            key={item.key}
            aria-disabled="true"
            className={styles.navDisabled}
            title="안전한 데이터 계약을 준비하고 있어요"
          >
            {item.label}
          </span>
        ),
      )}
    </nav>
  );
}
