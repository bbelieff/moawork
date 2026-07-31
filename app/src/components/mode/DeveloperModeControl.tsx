import Link from "next/link";
import styles from "./developer-mode-control.module.css";

/**
 * Presentation-only seam for a server-owned developer-mode contract.
 * It never infers platform access or persists a preference.
 */
export type DeveloperModeAction = {
  mode: "platform" | "user";
  /** Already-approved optional local next path. Server sanitizes it again. */
  next?: string;
};

export type ReleaseSelectorPayload = {
  route_path?: unknown;
  route_authorization?: unknown;
  release_ring?: unknown;
  is_internal?: unknown;
  internal_source?: unknown;
  feature_releases?: unknown;
};

export type DemoWorkspaceOption =
  | { kind: "available"; href: string }
  | { kind: "request-access" }
  | { kind: "unavailable" };

function featureIsExplicitlyOn(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && (value as Record<string, unknown>).platform_reviewed_demo === true;
}

function approvedWorkspacePath(value: unknown): string | null {
  return typeof value === "string" && /^\/w\/[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?(?:\/[^\\\u0000-\u001f\u007f]*)?$/u.test(value)
    ? value
    : null;
}

/**
 * Presentation adapter for T07's `resolveReleaseSelector(unknown)` output.
 * It never builds a workspace slug: a usable route must already be supplied
 * by the server and satisfy one of the two server-authorized cases.
 */
export function resolveDemoWorkspaceOption(selector: unknown): DemoWorkspaceOption {
  if (typeof selector !== "object" || selector === null) return { kind: "unavailable" };
  const payload = selector as ReleaseSelectorPayload;
  const href = approvedWorkspacePath(payload.route_path);
  if (!href) return { kind: "unavailable" };

  if (payload.route_authorization === "active_membership") return { kind: "available", href };
  if (
    payload.route_authorization === "reviewed_internal_demo"
    && payload.is_internal === true
    && payload.release_ring === "canary"
    && featureIsExplicitlyOn(payload.feature_releases)
  ) return { kind: "available", href };
  return { kind: "request-access" };
}

export function DeveloperModeControl({
  mode,
  action,
  serverConfirmedPlatform = false,
  demoSelectors,
}: {
  mode: "user" | "platform";
  action?: DeveloperModeAction;
  serverConfirmedPlatform?: boolean;
  /** Exact server-approved payloads from T07; never derived in this component. */
  demoSelectors?: readonly unknown[];
}) {
  const post = (approvedAction: DeveloperModeAction, label: string) => (
    <form action="/mode/preference" method="post" className={styles.form}>
      <input type="hidden" name="mode" value={approvedAction.mode} />
      {approvedAction.next ? <input type="hidden" name="next" value={approvedAction.next} /> : null}
      <button type="submit" className={styles.action} data-mode-action={approvedAction.mode}>{label}</button>
    </form>
  );

  if (mode === "user") {
    if (!serverConfirmedPlatform || action?.mode !== "platform") return null;
    return <>{post(action, "관리자 모드로")}{demoSelectors !== undefined ? <DeveloperModeDemoOptionsView selectors={demoSelectors} /> : null}</>;
  }

  return <><span className={styles.platformMode} data-mode="platform"><span className={styles.badge}>관리자 모드</span>{action?.mode === "user" ? post(action, "사용자 모드로") : null}</span>{demoSelectors !== undefined ? <DeveloperModeDemoOptionsView selectors={demoSelectors} /> : null}</>;
}

/** Availability is server-provided; this view never upgrades or requests access. */
export function DeveloperModeDemoOptionView({ selector }: { selector: unknown }) {
  const option = resolveDemoWorkspaceOption(selector);
  if (option.kind === "available") return <div className={styles.demo}><Link className={styles.demoAction} href={option.href}>데모 워크스페이스</Link></div>;
  return <p className={styles.demoState}>{option.kind === "request-access" ? "데모 워크스페이스는 접근 요청 후 사용할 수 있어요." : "데모 워크스페이스는 현재 사용할 수 없어요."}</p>;
}

/** Only server-approved, per-option selectors become entry links. */
export function DeveloperModeDemoOptionsView({ selectors }: { selectors: readonly unknown[] }) {
  const options = selectors
    .map(resolveDemoWorkspaceOption)
    .filter((option): option is Extract<DemoWorkspaceOption, { kind: "available" }> => option.kind === "available");
  if (options.length === 0) {
    return <p className={styles.demoState}>데모 워크스페이스는 현재 사용할 수 없어요. 접근이 필요하면 요청해 주세요.</p>;
  }
  return <div className={styles.demo}>{options.map((option, index) => <Link key={option.href} className={styles.demoAction} href={option.href}>데모 워크스페이스 {index + 1}</Link>)}</div>;
}
