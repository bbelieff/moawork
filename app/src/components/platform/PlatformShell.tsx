import Link from "next/link";
import type { ReactNode } from "react";
import { PLATFORM_NAV, PLATFORM_NAV_GROUPS, activePlatformSection } from "./nav";
import styles from "./platform.module.css";
import type { PlatformAggregateState, PlatformSectionKey } from "@/lib/platform/contracts";
import { DeveloperModeControl, type DeveloperModeAction } from "@/components/mode/DeveloperModeControl";

export function PlatformShell({
  pathname,
  title,
  description,
  children,
  userModeAction,
}: {
  pathname: string;
  title: string;
  description: string;
  children: ReactNode;
  /** Trusted platform-to-user destination; supplied by the server adapter later. */
  userModeAction?: DeveloperModeAction;
}) {
  const active = activePlatformSection(pathname);
  const activeItem = PLATFORM_NAV.find((item) => item.key === active);
  return (
    <div className={styles.root}>
      <header className={styles.band} role="note">
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>
          <div><strong>모아워크 운영 관리</strong><span>서비스 관리자 전용</span></div>
        </div>
        <p className={styles.safety}>서비스 관리자 화면이에요. 고객 업무 정보는 별도 권한이 있을 때만 볼 수 있어요.</p>
        <DeveloperModeControl mode="platform" action={userModeAction ?? { mode: "user" }} />
      </header>
      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label="서비스 운영 메뉴">
          <div className={styles.sidebarHeading}><span>서비스 관리</span><strong>운영 메뉴</strong></div>
          {PLATFORM_NAV_GROUPS.map((group) => (
            <section className={styles.navGroup} aria-labelledby={`platform-nav-${group.key}`} key={group.key}>
              <p id={`platform-nav-${group.key}`} className={styles.navGroupLabel}>{group.label}</p>
              <ul>
                {PLATFORM_NAV.filter((item) => item.group === group.key).map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} aria-current={item.key === active ? "page" : undefined} className={item.key === active ? styles.active : undefined}>
                      <span className={styles.navMark} aria-hidden="true" />
                      <span className={styles.navCopy}><strong>{item.label}</strong><small>{item.description}</small></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <main className={styles.main}>
          <div className={styles.mainInner}>
            <header className={styles.heading}>
              <p className={styles.eyebrow}>서비스 운영 <span aria-hidden="true">/</span> {activeItem?.label ?? title}</p>
              <h1>{title}</h1>
              <p>{description}</p>
            </header>
            <div className={styles.content}>{children}</div>
          </div>
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
