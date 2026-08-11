/**
 * BBE-13 플랫폼 운영 탭의 실행 가능한 데이터·권한 계약.
 *
 * 플랫폼 운영 권한은 tenant 데이터 권한이 아니다. 각 탭은 아래에 적힌
 * 기존 RPC와 현재 운영자 자신의 범위만 읽으며, 쓰기는 후속 검토 계약 전까지
 * 모두 닫아 둔다. 데이터 원문, 개인 식별자, 고객별 상세는 표시하지 않는다.
 */
export const PLATFORM_OPERATION_SECTION_KEYS = [
  "billing",
  "access",
  "support",
  "admins",
] as const;

export type PlatformOperationSectionKey =
  (typeof PLATFORM_OPERATION_SECTION_KEYS)[number];

export type PlatformOperationContract = {
  section: PlatformOperationSectionKey;
  label: string;
  authorization: {
    principal: "canonical-platform-operator";
    guard: "loadPlatformActor/is_platform_admin";
    directTableAccess: false;
    platformRoleGrantsTenantAccess: false;
  };
  currentRead: {
    availability: "contract-status" | "self-scope";
    reader: "none" | "get_my_support_read_scope" | "app_admin_role";
    summary: string;
  };
  currentWrite: {
    enabled: false;
    policy: "separate-reviewed-contract-required";
  };
  allowedData: readonly string[];
  forbiddenData: readonly string[];
  audit: {
    privilegedRead: readonly string[];
    futureMutation: readonly string[];
    forbiddenPayload: readonly string[];
  };
};

const COMMON_FORBIDDEN_DATA = [
  "고객 원본 레코드",
  "세무·결제 증빙 원문",
  "이름·이메일·전화번호 같은 개인 식별 정보",
  "사용자 가장 또는 세션·쿠키·토큰",
  "활성 멤버십 없이 읽는 회사 데이터",
] as const;

const COMMON_READ_AUDIT = [
  "서버가 auth.uid()로 확정한 actor",
  "탭·집계 범위·요청 시각",
  "허용·거부·실패 결과와 reason code",
] as const;

const COMMON_MUTATION_AUDIT = [
  "서버가 생성하거나 검증한 request_id",
  "actor·대상 UUID·operation·before/after metadata",
  "발생 시각·결과·실패 reason code",
] as const;

const COMMON_FORBIDDEN_AUDIT_PAYLOAD = [
  "비밀값·인증 헤더·쿠키",
  "고객·세무 원문",
  "자유입력 개인 정보",
] as const;

export const PLATFORM_OPERATION_CONTRACTS = {
  billing: {
    section: "billing",
    label: "결제·매출",
    authorization: {
      principal: "canonical-platform-operator",
      guard: "loadPlatformActor/is_platform_admin",
      directTableAccess: false,
      platformRoleGrantsTenantAccess: false,
    },
    currentRead: {
      availability: "contract-status",
      reader: "none",
      summary: "현재 main에는 결제·매출 전용 비식별 집계 reader가 없습니다.",
    },
    currentWrite: {
      enabled: false,
      policy: "separate-reviewed-contract-required",
    },
    allowedData: [
      "기간별 합계와 건수",
      "통화·기준일·집계 생성 시각",
      "개인을 식별하지 않는 결제 상태별 집계",
    ],
    forbiddenData: [
      ...COMMON_FORBIDDEN_DATA,
      "계좌·카드·현금영수증·세금계산서 원문",
      "고객별 결제 내역과 미수금 상세",
    ],
    audit: {
      privilegedRead: COMMON_READ_AUDIT,
      futureMutation: COMMON_MUTATION_AUDIT,
      forbiddenPayload: COMMON_FORBIDDEN_AUDIT_PAYLOAD,
    },
  },
  access: {
    section: "access",
    label: "접근 기록",
    authorization: {
      principal: "canonical-platform-operator",
      guard: "loadPlatformActor/is_platform_admin",
      directTableAccess: false,
      platformRoleGrantsTenantAccess: false,
    },
    currentRead: {
      availability: "contract-status",
      reader: "none",
      summary: "감사 저장소는 있지만 플랫폼 전용 비식별 집계 reader는 없습니다.",
    },
    currentWrite: {
      enabled: false,
      policy: "separate-reviewed-contract-required",
    },
    allowedData: [
      "행동 유형·결과·시간대별 건수",
      "권한 거부·실패 reason code 집계",
      "개인을 식별하지 않는 보존 범위와 상태",
    ],
    forbiddenData: [
      ...COMMON_FORBIDDEN_DATA,
      "원시 IP·user-agent·요청 본문",
      "개별 사용자의 행동 타임라인",
    ],
    audit: {
      privilegedRead: COMMON_READ_AUDIT,
      futureMutation: COMMON_MUTATION_AUDIT,
      forbiddenPayload: COMMON_FORBIDDEN_AUDIT_PAYLOAD,
    },
  },
  support: {
    section: "support",
    label: "지원",
    authorization: {
      principal: "canonical-platform-operator",
      guard: "loadPlatformActor/is_platform_admin",
      directTableAccess: false,
      platformRoleGrantsTenantAccess: false,
    },
    currentRead: {
      availability: "self-scope",
      reader: "get_my_support_read_scope",
      summary: "현재 운영자에게 승인된 읽기 전용 지원 범위의 건수와 만료만 읽습니다.",
    },
    currentWrite: {
      enabled: false,
      policy: "separate-reviewed-contract-required",
    },
    allowedData: [
      "현재 운영자 자신의 활성 지원 범위 건수",
      "가장 가까운 지원 범위 만료 시각",
      "읽기 전용 여부",
    ],
    forbiddenData: [
      ...COMMON_FORBIDDEN_DATA,
      "문의·메시지·첨부파일 원문",
      "지원 grant를 tenant 권한이나 가장 권한으로 변환",
    ],
    audit: {
      privilegedRead: COMMON_READ_AUDIT,
      futureMutation: [
        ...COMMON_MUTATION_AUDIT,
        "지원 목적·승인자·만료·철회를 구조화된 metadata로 기록",
      ],
      forbiddenPayload: COMMON_FORBIDDEN_AUDIT_PAYLOAD,
    },
  },
  admins: {
    section: "admins",
    label: "어드민 관리",
    authorization: {
      principal: "canonical-platform-operator",
      guard: "loadPlatformActor/is_platform_admin",
      directTableAccess: false,
      platformRoleGrantsTenantAccess: false,
    },
    currentRead: {
      availability: "self-scope",
      reader: "app_admin_role",
      summary: "app_admin_role()로 현재 인증 계정 자신의 허용 역할만 확인합니다.",
    },
    currentWrite: {
      enabled: false,
      policy: "separate-reviewed-contract-required",
    },
    allowedData: [
      "현재 인증 계정 자신의 운영 허용 역할",
      "권한 정책 버전과 마지막 검수 시각",
      "향후 승인된 비식별 역할별 건수",
    ],
    forbiddenData: [
      ...COMMON_FORBIDDEN_DATA,
      "app_admins 직접 조회 결과",
      "이메일 허용 목록을 tenant 역할이나 플랫폼 권한으로 재해석",
      "검수 없는 관리자 추가·해제·역할 변경",
    ],
    audit: {
      privilegedRead: COMMON_READ_AUDIT,
      futureMutation: [
        ...COMMON_MUTATION_AUDIT,
        "승인 근거·권한 변경 전후·복구 reference",
      ],
      forbiddenPayload: COMMON_FORBIDDEN_AUDIT_PAYLOAD,
    },
  },
} as const satisfies Record<PlatformOperationSectionKey, PlatformOperationContract>;
