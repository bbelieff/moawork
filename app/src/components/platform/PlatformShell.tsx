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

const BOUNDARY_COPY = "고객사·사용자·업무 원본, 세무 정보, 개인정보 표시·내려받기, 사용자 전환은 제공하지 않습니다.";

/** 상태 배지 — 실제 인프라 상태만 말한다. 값 자체를 꾸미지 않는다. */
function aggregateBadges(state: Extract<PlatformAggregateState, { kind: "ready" }>) {
  const badges: { key: string; tone: "warn" | "info"; text: string }[] = [];
  if (state.freshness.kind === "stale") {
    badges.push({
      key: "stale",
      tone: "warn",
      text: `오래된 집계 — ${state.freshness.ageHours}시간 전 계산 (기준 ${state.freshness.staleAfterHours}시간)`,
    });
  }
  if (state.freshness.kind === "unknown") {
    badges.push({ key: "freshness-unknown", tone: "warn", text: "집계 시각 미상 — 최신인지 확인할 수 없어요" });
  }
  if (state.coverage.partial) {
    badges.push({
      key: "partial",
      tone: "warn",
      text: `일부만 표시 — ${state.coverage.receivedRows}행 중 ${state.coverage.usableRows}행 사용 (형식 불일치 ${state.coverage.droppedRows}행 제외)`,
    });
  }
  if (state.allZero) {
    badges.push({ key: "true-zero", tone: "info", text: "집계는 정상 실행됐고 값이 실제로 0이에요" });
  }
  return badges;
}

export function PlatformAggregatePanel({ section, state }: { section: PlatformSectionKey; state: PlatformAggregateState }) {
  const label = PLATFORM_NAV.find((item) => item.key === section)?.label ?? "운영 정보";
  if (state.kind === "not-contracted") {
    return <section className={styles.panel} aria-labelledby="aggregate-state-title"><h2 id="aggregate-state-title">{label} 정보를 아직 연결하지 않았어요</h2><p>{state.message}</p><p className={styles.boundary}>{BOUNDARY_COPY}</p></section>;
  }
  if (state.kind === "unavailable") {
    return <section className={styles.panel} aria-labelledby="aggregate-state-title"><h2 id="aggregate-state-title">{label} 집계를 불러오지 못했어요</h2><p>{state.message}</p><p className={styles.statusHint}>표시할 수치가 0이라는 뜻이 아니에요. 확인되지 않은 값을 대신 채우지 않습니다.</p><p className={styles.boundary}>{BOUNDARY_COPY}</p></section>;
  }
  if (state.kind === "empty") {
    return <section className={styles.panel} aria-labelledby="aggregate-state-title"><h2 id="aggregate-state-title">{label} 집계 스냅샷이 아직 없어요</h2><p>{state.message}</p><p className={styles.statusHint}>최근 {state.coverage.requestedDays}일 범위에서 집계 행이 0건이었어요. 연결은 살아 있고, 아직 계산된 스냅샷이 없는 상태예요.</p><p className={styles.boundary}>{BOUNDARY_COPY}</p></section>;
  }
  const badges = aggregateBadges(state);
  return <section className={styles.grid} aria-label={`${label} 집계`}>
    {badges.length > 0 ? <ul className={styles.statusBadges} aria-label="집계 상태">
      {badges.map((badge) => <li key={badge.key} className={`${styles.statusBadge} ${badge.tone === "warn" ? styles.statusWarn : styles.statusInfo}`}>{badge.text}</li>)}
    </ul> : null}
    {state.values.map((value) => <article className={styles.card} key={value.label}><p>{value.label}</p><strong>{value.value ?? "—"}</strong><small>{value.description}</small></article>)}
    <p className={styles.freshness}>
      {state.updatedAt ? `마지막 집계: ${state.updatedAt}` : "마지막 집계 시각을 확인할 수 없어요"}
      {` · 최근 ${state.coverage.requestedDays}일 중 ${state.coverage.usableRows}일치 표시`}
    </p>
  </section>;
}
