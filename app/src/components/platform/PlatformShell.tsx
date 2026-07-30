import Link from "next/link";
import type { ReactNode } from "react";
import { PLATFORM_NAV, activePlatformSection } from "./nav";
import styles from "./platform.module.css";
import type { PlatformAggregateState, PlatformSectionKey } from "@/lib/platform/contracts";

export function PlatformShell({
  pathname,
  title,
  description,
  children,
}: {
  pathname: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const active = activePlatformSection(pathname);
  return (
    <div className={styles.root}>
      <header className={styles.band} role="note">
        <span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>
        <div><strong>MoaWork 플랫폼 운영</strong><span>고객 회사의 원본 업무와 개인정보는 이 화면에서 열리지 않아요.</span></div>
      </header>
      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label="플랫폼 운영 메뉴">
          <p>운영 콘솔</p>
          <ul>
            {PLATFORM_NAV.map((item) => (
              <li key={item.key}>
                <Link href={item.href} aria-current={item.key === active ? "page" : undefined} className={item.key === active ? styles.active : undefined}>
                  <span>{item.label}</span><small>{item.description}</small>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className={styles.main}>
          <header className={styles.heading}><p>플랫폼 운영</p><h1>{title}</h1><p>{description}</p></header>
          {children}
        </main>
      </div>
    </div>
  );
}

export function PlatformAggregatePanel({ section, state }: { section: PlatformSectionKey; state: PlatformAggregateState }) {
  const label = PLATFORM_NAV.find((item) => item.key === section)?.label ?? "운영 정보";
  if (state.kind === "unavailable") {
    return <section className={styles.panel} aria-labelledby="unavailable-title"><h2 id="unavailable-title">{label} 정보를 아직 연결하지 않았어요</h2><p>{state.message}</p><p className={styles.boundary}>고객사·사용자·업무 원본, 세무 정보, 개인정보 표시·내려받기, 사용자 전환은 제공하지 않습니다.</p></section>;
  }
  return <section className={styles.grid} aria-label={`${label} 집계`}>
    {state.values.map((value) => <article className={styles.card} key={value.label}><p>{value.label}</p><strong>{value.value ?? "—"}</strong><small>{value.description}</small></article>)}
    {state.updatedAt ? <p className={styles.freshness}>마지막 집계: {state.updatedAt}</p> : null}
  </section>;
}
