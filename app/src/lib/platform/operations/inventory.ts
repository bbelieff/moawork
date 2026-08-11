import type { PlatformOperationSectionKey } from "./contracts";

export type PlatformOperationRepositoryArtifact = {
  kind: "route" | "table" | "rpc" | "guard" | "adapter";
  name: string;
  source: string;
  useForTab: "none" | "guard-only" | "self-scope-only";
  note: string;
};

export type PlatformOperationRepositoryInventory = {
  section: PlatformOperationSectionKey;
  currentTabState: "contract-status" | "self-scope";
  repositoryVerification: "origin-main-static";
  repositoryState:
    | "route-only"
    | "schema-without-safe-tab-reader"
    | "self-scope-reader"
    | "guard-and-self-role";
  hostedVerification: "not-run";
  safeReader: null | "get_my_support_read_scope" | "app_admin_role";
  artifacts: readonly PlatformOperationRepositoryArtifact[];
};

export const PLATFORM_OPERATION_REPOSITORY_INVENTORY = {
  billing: {
    section: "billing",
    currentTabState: "contract-status",
    repositoryVerification: "origin-main-static",
    repositoryState: "route-only",
    hostedVerification: "not-run",
    safeReader: null,
    artifacts: [
      {
        kind: "route",
        name: "/platform/billing",
        source: "app/src/app/platform/billing/page.tsx",
        useForTab: "none",
        note: "현재 연결 상태와 허용 범위만 표시하며 결제 금액을 추측하지 않습니다.",
      },
      {
        kind: "rpc",
        name: "platform_console_metrics_daily(date,date)",
        source: "supabase/migrations/016_platform_console_metrics_alignment.sql",
        useForTab: "none",
        note: "제품 사용 집계이므로 결제·매출·정산 집계로 재사용하지 않습니다.",
      },
    ],
  },
  access: {
    section: "access",
    currentTabState: "contract-status",
    repositoryVerification: "origin-main-static",
    repositoryState: "schema-without-safe-tab-reader",
    hostedVerification: "not-run",
    safeReader: null,
    artifacts: [
      {
        kind: "table",
        name: "member_account_ops_audit",
        source: "supabase/migrations/011_member_account_ops.sql",
        useForTab: "none",
        note: "직접 table 권한이 철회되어 있고 플랫폼 비식별 집계 reader가 없습니다.",
      },
      {
        kind: "table",
        name: "audit_logs",
        source: "supabase/migrations/019_notifications.sql",
        useForTab: "none",
        note: "회사별 알림 feed이므로 플랫폼 접근 기록으로 재사용하지 않습니다.",
      },
    ],
  },
  support: {
    section: "support",
    currentTabState: "self-scope",
    repositoryVerification: "origin-main-static",
    repositoryState: "self-scope-reader",
    hostedVerification: "not-run",
    safeReader: "get_my_support_read_scope",
    artifacts: [
      {
        kind: "rpc",
        name: "get_my_support_read_scope()",
        source: "supabase/migrations/011_member_account_ops.sql",
        useForTab: "self-scope-only",
        note: "현재 운영자 자신의 활성 읽기 전용 범위만 반환합니다.",
      },
      {
        kind: "rpc",
        name: "request_support_read_access/approve_support_read_access",
        source: "supabase/migrations/011_member_account_ops.sql",
        useForTab: "none",
        note: "mutation RPC라서 이 read-only 탭에서 호출하지 않습니다.",
      },
    ],
  },
  admins: {
    section: "admins",
    currentTabState: "self-scope",
    repositoryVerification: "origin-main-static",
    repositoryState: "guard-and-self-role",
    hostedVerification: "not-run",
    safeReader: "app_admin_role",
    artifacts: [
      {
        kind: "table",
        name: "app_admins",
        source: "supabase/migrations/005_app_admins.sql",
        useForTab: "none",
        note: "RLS가 켜진 허용 목록이며 직접 조회하지 않습니다.",
      },
      {
        kind: "rpc",
        name: "app_admin_role(text)",
        source: "supabase/migrations/005_app_admins.sql",
        useForTab: "self-scope-only",
        note: "서버가 인증한 현재 계정 이메일로 자신의 역할만 확인합니다.",
      },
      {
        kind: "guard",
        name: "is_platform_admin()",
        source: "supabase/migrations/017_fix_is_platform_admin_role_axis.sql",
        useForTab: "guard-only",
        note: "auth.uid() 기반 플랫폼 진입 guard이며 tenant 권한을 부여하지 않습니다.",
      },
    ],
  },
} as const satisfies Record<
  PlatformOperationSectionKey,
  PlatformOperationRepositoryInventory
>;
