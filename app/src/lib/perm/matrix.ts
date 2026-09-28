// 권한 역할 4종 × 24항목 — BBE-122 (D23 · D24).
//
// 카드 제목은 "22항목"이지만 정본 목업(docs/design/UI목업_워크스페이스_최종_v6.html)의
// `const PERM` 배열 실측은 24항목(업무5·구조5·자동화발송4·조직공지5·위험5)이다.
// "카드보다 목업이 우선" 원칙에 따라 24항목으로 구현한다. 수치는
// `node docs/design/qa-mockup.mjs` 로 재현 가능(75/75 통과 확인분).
//
// 이 상수는 supabase/migrations/055_permission_role_matrix.sql 의 `perm_baseline()` 함수와
// 반드시 같은 값을 가져야 한다 — 드리프트는 matrix.test.ts 가 막는다.

import { roleLabel, scopeLabel, MEMBER_ROLES, isMemberRole, type MemberRole } from "@/lib/auth/roles";

/*
 * ★ 역할 목록을 여기서 «다시 적지» 않는다. 정본은 `lib/types/index.ts` 하나다.
 *
 *   전에는 `["owner","admin","team_lead","member"] as const` 를 여기 적어 두고
 *   그것으로 «자기 Role 타입» 을 만들었다. 값이 우연히 정본과 같아서 조용했지만,
 *   정본에만 역할을 하나 늘리면 `Role` 과 `MemberRole` 이 **조용히 갈라진다** —
 *   컴파일러는 두 타입이 «지금» 같은 모양이라 아무 말도 안 한다.
 *   그리고 갈라지는 자리가 하필 **권한표** 다. 새 역할의 권한 칸이 안 생기는데 아무도 모른다.
 *
 *   2026-08-11 에 `team_lead` 가 생겼을 때 이 병으로 일곱 군데가 어긋났고,
 *   그중 하나(#676)는 팀장인 사람이 **제품에 못 들어오게** 만들었다.
 */
export const ROLES = MEMBER_ROLES;
export type Role = MemberRole;

export const isRole = isMemberRole;

/*
 * ★ 이름표를 여기 적지 않는다 — 정본은 lib/auth/roles.ts 다.
 *   전에는 「소유자」·「멤버」였고, 같은 사람이 조직관리에서는 「대표」·「구성원」으로 보였다.
 *   권한표와 조직관리는 «나란히 있는 갈래» 라서 그 차이가 특히 눈에 띄었다.
 */
export const ROLE_LABEL: Record<Role, string> = {
  owner: roleLabel("owner"),
  admin: roleLabel("admin"),
  team_lead: roleLabel("team_lead"),
  member: roleLabel("member"),
};

/*
 * D24 — 조회 범위가 뷰보다 먼저 적용된다. 역할별 데이터 범위(표시용 · 실제 행 단위 시행은
 * 기존 org_members.scope=all/assigned 및 후속 부서-스코프 작업 소관, 이 카드는 판정 로직만 소유).
 *
 * ★ 이건 «역할 → 기본 조회 범위» 라 scope 이름표와 다른 축이지만, 같은 말을 쓴다.
 *   「전체」와 「회사 전체」가 한 화면에 같이 뜨면 다른 뜻으로 읽힌다.
 */
export const ROLE_DATA_SCOPE_LABEL: Record<Role, string> = {
  owner: scopeLabel("all"),
  admin: scopeLabel("all"),
  team_lead: scopeLabel("department"),
  member: scopeLabel("assigned"),
};

export type PermItem = {
  scopeKey: string;
  label: string;
  description?: string;
  /** 위험 5항목 — 반드시 실행 기록을 남긴다(record_risky_action). */
  danger?: boolean;
  /** [소유자, 관리자, 팀장, 멤버] 순서 — 목업 PERM 배열의 role bit array 와 동일 순서. */
  defaultAllowed: readonly [boolean, boolean, boolean, boolean];
};

export type PermGroup = {
  group: string;
  items: readonly PermItem[];
};

export const PERM_MATRIX: readonly PermGroup[] = [
  {
    group: "업무",
    items: [
      { scopeKey: "work.view_tabs", label: "탭 보기", description: "신규업체·컨택업체·업무관리·업체관리·공지사항 열람", defaultAllowed: [true, true, true, true] },
      { scopeKey: "work.item_upsert", label: "항목 추가·수정", description: "업체를 만들고 값을 고칩니다", defaultAllowed: [true, true, true, true] },
      { scopeKey: "work.assign_owner", label: "담당자 지정", description: "다른 사람에게 배정할 수 있습니다", defaultAllowed: [true, true, true, false] },
      { scopeKey: "work.item_delete", label: "항목 삭제", description: "되돌리기 어렵습니다", defaultAllowed: [true, true, false, false] },
      { scopeKey: "work.edit_others_items", label: "다른 사람 담당 건 수정", description: "본인 담당이 아닌 건을 고칩니다", defaultAllowed: [true, true, true, false] },
    ],
  },
  {
    group: "구조",
    items: [
      { scopeKey: "structure.column_manage", label: "컬럼 추가·삭제", description: "보드 전체에 영향을 줍니다", defaultAllowed: [true, true, false, false] },
      { scopeKey: "structure.section_manage", label: "아이템 추가·삭제", description: "그룹 구조를 바꿉니다", defaultAllowed: [true, true, false, false] },
      { scopeKey: "structure.preset_edit", label: "프리셋 편집", description: "회사 공용 템플릿을 고칩니다", defaultAllowed: [true, true, false, false] },
      { scopeKey: "structure.shared_view_save", label: "공용 뷰 저장", description: "모두가 보는 뷰를 만듭니다", defaultAllowed: [true, true, true, false] },
      { scopeKey: "structure.tab_manage", label: "탭 순서·이름", description: "사이드바를 바꿉니다", defaultAllowed: [true, true, false, false] },
    ],
  },
  {
    group: "자동화 · 발송",
    items: [
      { scopeKey: "automation.view", label: "자동화 규칙 보기", description: "어떤 규칙이 도는지 확인", defaultAllowed: [true, true, true, true] },
      { scopeKey: "automation.edit", label: "자동화 규칙 편집", description: "상태가 바뀔 때 무슨 일이 생길지 정합니다", defaultAllowed: [true, true, false, false] },
      { scopeKey: "automation.send_message", label: "문자·알림톡 발송", description: "건당 비용이 나갑니다", defaultAllowed: [true, true, true, false] },
      { scopeKey: "automation.template_edit", label: "발송 템플릿 편집", description: "고객에게 나가는 문구입니다", defaultAllowed: [true, true, false, false] },
    ],
  },
  {
    group: "조직 · 공지",
    items: [
      { scopeKey: "org.view_chart", label: "조직도 보기", defaultAllowed: [true, true, true, true] },
      { scopeKey: "org.member_manage", label: "조직원 초대·이동", description: "부서를 바꾸면 보고선이 함께 바뀝니다", defaultAllowed: [true, true, false, false] },
      { scopeKey: "org.grant_permission", label: "권한 부여", description: "이 화면을 쓸 수 있습니다", defaultAllowed: [true, true, false, false] },
      { scopeKey: "org.dept_notice", label: "부서 공지 발송", description: "내 부서 이하에 보냅니다", defaultAllowed: [true, true, true, false] },
      { scopeKey: "org.company_notice", label: "전사 공지 발송", description: "전 직원에게 갑니다", defaultAllowed: [true, true, false, false] },
    ],
  },
  {
    group: "위험",
    items: [
      { scopeKey: "danger.csv_export", label: "CSV 내보내기", description: "고객 정보가 파일로 빠져나갑니다 · 내역이 기록됩니다", danger: true, defaultAllowed: [true, true, false, false] },
      { scopeKey: "danger.bulk_edit_delete", label: "일괄 수정·삭제", description: "여러 건을 한 번에 바꿉니다", danger: true, defaultAllowed: [true, false, false, false] },
      { scopeKey: "danger.view_accounting_amount", label: "회계 금액 보기", description: "계약금·수수료 금액", danger: true, defaultAllowed: [true, true, true, false] },
      { scopeKey: "danger.year_end_archive", label: "연말 아카이빙", description: "되돌릴 수 없습니다", danger: true, defaultAllowed: [true, false, false, false] },
      { scopeKey: "danger.data_import", label: "데이터 가져오기·이관", description: "외부 데이터를 밀어 넣습니다", danger: true, defaultAllowed: [true, false, false, false] },
    ],
  },
];

export const ALL_PERM_ITEMS: readonly PermItem[] = PERM_MATRIX.flatMap((g) => g.items);

export const PERM_ITEM_COUNT = ALL_PERM_ITEMS.length;

const SCOPE_KEY_SET = new Set(ALL_PERM_ITEMS.map((i) => i.scopeKey));

export function isKnownScopeKey(scopeKey: string): boolean {
  return SCOPE_KEY_SET.has(scopeKey);
}

export function findPermItem(scopeKey: string): PermItem | undefined {
  return ALL_PERM_ITEMS.find((i) => i.scopeKey === scopeKey);
}
