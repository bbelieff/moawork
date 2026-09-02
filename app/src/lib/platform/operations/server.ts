import { createClient } from "@/lib/supabase/server";
import { parseAdminRole } from "@/lib/auth/admin";
import { roleLabel } from "@/lib/auth/roles";
import {
  PLATFORM_OPERATION_CONTRACTS,
  type PlatformOperationSectionKey,
} from "./contracts";

type RpcResult = { data: unknown; error: unknown | null };

export type PlatformOperationClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { email?: unknown } | null };
      error: unknown | null;
    }>;
  };
  rpc: (
    name: "app_admin_role" | "get_my_support_read_scope",
    args?: Record<string, unknown>,
  ) => Promise<RpcResult>;
};

export type PlatformOperationValue = {
  label: string;
  value: string;
  description: string;
};

export type PlatformOperationSnapshot =
  | {
      kind: "ready" | "limited";
      section: PlatformOperationSectionKey;
      observedAt: string;
      values: readonly PlatformOperationValue[];
    }
  | {
      kind: "unavailable";
      section: PlatformOperationSectionKey;
      message: string;
    };

type CurrentRole = { kind: "ready"; label: string } | { kind: "unavailable" };

/*
 * ★ 이름표는 lib/auth/roles.ts 하나에서 온다.
 *   전에는 owner·admin 만 따로 보고 «나머지 전부» 를 「구성원」으로 떨어뜨렸다.
 *   그래서 team_lead 가 «구성원» 으로 보였다 — parseAdminRole 이 isMemberRole 만 통과시키므로
 *   실제로 도달하는 경로다. 「나머지는 다」로 접으면 새 역할이 생길 때마다 조용히 틀린다.
 */

async function loadCurrentRole(client: PlatformOperationClient): Promise<CurrentRole> {
  const userResult = await client.auth.getUser();
  const email = userResult.data.user?.email;
  if (userResult.error || typeof email !== "string" || email.length === 0) {
    return { kind: "unavailable" };
  }

  const roleResult = await client.rpc("app_admin_role", {
    p_email: email.toLowerCase(),
  });
  const role = parseAdminRole(roleResult.data);
  if (roleResult.error || role === null) {
    return { kind: "unavailable" };
  }
  return { kind: "ready", label: roleLabel(role) };
}

function supportExpiry(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const expiresAt = (value as Record<string, unknown>).expires_at;
  if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) {
    return null;
  }
  return expiresAt;
}

function displayTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function limitedSnapshot(
  section: "billing" | "access",
  role: CurrentRole & { kind: "ready" },
  now: Date,
): PlatformOperationSnapshot {
  const contract = PLATFORM_OPERATION_CONTRACTS[section];
  return {
    kind: "limited",
    section,
    observedAt: now.toISOString(),
    values: [
      {
        label: "현재 운영 권한",
        value: role.label,
        description: "현재 인증 계정 자신의 허용 역할만 확인했어요.",
      },
      {
        label: "데이터 연결",
        value: "아직 연결되지 않음",
        description: contract.currentRead.summary,
      },
      {
        label: "표시 범위",
        value: "비식별 집계만",
        description: "원문이나 고객별 상세를 대신 보여주지 않아요.",
      },
    ],
  };
}

export async function loadPlatformOperationSnapshot(
  section: PlatformOperationSectionKey,
  now: Date = new Date(),
  suppliedClient?: PlatformOperationClient,
): Promise<PlatformOperationSnapshot> {
  try {
    const client = suppliedClient ??
      ((await createClient()) as unknown as PlatformOperationClient);
    const role = await loadCurrentRole(client);
    if (role.kind === "unavailable") {
      return {
        kind: "unavailable",
        section,
        message: "현재 운영 역할을 확인하지 못했어요. 권한을 넓혀 추측하지 않습니다.",
      };
    }

    if (section === "billing" || section === "access") {
      return limitedSnapshot(section, role, now);
    }

    if (section === "admins") {
      return {
        kind: "ready",
        section,
        observedAt: now.toISOString(),
        values: [
          {
            label: "현재 운영 역할",
            value: role.label,
            description: "app_admin_role()로 현재 인증 계정 자신만 확인했어요.",
          },
          {
            label: "관리자 목록",
            value: "표시하지 않음",
            description: "허용 목록 원문이나 다른 관리자의 식별 정보는 읽지 않아요.",
          },
          {
            label: "변경 권한",
            value: "사용 안 함",
            description: "추가·해제·역할 변경은 별도 검수 계약이 필요해요.",
          },
        ],
      };
    }

    const scopeResult = await client.rpc("get_my_support_read_scope", {});
    if (scopeResult.error || !Array.isArray(scopeResult.data)) {
      return {
        kind: "unavailable",
        section,
        message: "현재 계정의 지원 범위를 불러오지 못했어요. 0건으로 표시하지 않습니다.",
      };
    }

    const expiries = scopeResult.data
      .map(supportExpiry)
      .filter((value): value is string => value !== null)
      .sort((left, right) => Date.parse(left) - Date.parse(right));
    if (expiries.length !== scopeResult.data.length) {
      return {
        kind: "unavailable",
        section,
        message: "지원 범위 응답 형식을 확인하지 못했어요. 확인되지 않은 행은 숨깁니다.",
      };
    }

    return {
      kind: "ready",
      section,
      observedAt: now.toISOString(),
      values: [
        {
          label: "내 읽기 전용 지원 범위",
          value: `${expiries.length}건`,
          description: "현재 인증 계정에 승인되어 있고 만료되지 않은 범위만 세었어요.",
        },
        {
          label: "가장 가까운 만료",
          value: expiries[0] ? displayTime(expiries[0]) : "활성 범위 없음",
          description: "회사 ID·목적·고객 원문은 표시하지 않아요.",
        },
        {
          label: "접근 방식",
          value: "읽기 전용",
          description: "지원 범위를 회사 권한이나 사용자 가장 권한으로 바꾸지 않아요.",
        },
      ],
    };
  } catch {
    return {
      kind: "unavailable",
      section,
      message: "운영 데이터를 불러오지 못했어요. 확인되지 않은 값을 채우지 않습니다.",
    };
  }
}
