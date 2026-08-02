// T07 · 플랫폼 콘솔 셸(서버 컴포넌트).
//
// 고객 화면과 같은 뼈대(사이드바 + 본문)에 색만 다르다.
// 운영자 밴드를 상단 고정해 "여기는 고객 평면이 아니다"를 상시 알린다.

import Link from "next/link";
import type { ReactNode } from "react";
import { PLATFORM_NAV, activeNavKey } from "./nav";
import styles from "./platform.module.css";
import type { AdminLevel } from "@/lib/platform/types";

const LEVEL_LABEL: Record<AdminLevel, string> = {
  super: "super",
  operator: "operator",
  viewer: "viewer",
};

export function PlatformShell({
  level,
  pathname,
  title,
  description,
  children,
}: {
  level: AdminLevel;
  /** 활성 메뉴 판정용 현재 경로. */
  pathname: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const active = activeNavKey(pathname);

  return (
    <div className={styles.root}>
      <div className={styles.band} role="note">
        <span className={styles.bandMark}>MoaWork 운영</span>
        <span className={styles.bandNote}>
          플랫폼 평면입니다 · 고객 회사 업무 데이터에는 접근하지 않습니다
        </span>
        <span className={styles.bandSpacer} />
        <span className={styles.levelChip}>{LEVEL_LABEL[level]}</span>
      </div>

      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label="플랫폼 운영 메뉴">
          <p className={styles.sidebarTitle}>운영 콘솔</p>
          <ul className={styles.navList}>
            {PLATFORM_NAV.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className={`${styles.navLink} ${
                    item.key === active ? styles.navLinkActive : ""
                  }`}
                  aria-current={item.key === active ? "page" : undefined}
                >
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className={styles.main}>
          <header className={styles.pageHead}>
            <h1>{title}</h1>
            {description ? <p>{description}</p> : null}
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}

/** 지표 타일. 값이 없으면 '—' 를 넣어 호출한다(NaN·빈칸 금지). */
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      <div className={styles.cardValue}>{value}</div>
      {hint ? <div className={styles.cardHint}>{hint}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h2>{title}</h2>
        {note ? <p>{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** 아직 담당 트랙이 테이블/화면을 만들지 않은 자리. */
export function ComingSoon({ children }: { children: ReactNode }) {
  return <div className={styles.placeholder}>{children}</div>;
}

export { styles as platformStyles };
