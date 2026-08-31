// 권한 역할 4종 × 26항목 — BBE-122 + Issue #646 finance seams.
//
// 카드 제목은 "22항목"이지만 정본 목업(docs/design/UI목업_워크스페이스_최종_v6.html)의
// `const PERM` 배열 실측 24항목(업무5·구조5·자동화발송4·조직공지5·위험5)에
// Case 원장의 read/manage 권한 seam 2개를 additive로 더한다. 수치는
// `node docs/design/qa-mockup.mjs` 로 재현 가능(75/75 통과 확인분).
//
// 이 상수는 최신 supabase migration의 `perm_baseline()` 함수와
// 반드시 같은 값을 가져야 한다 — 드리프트는 matrix.test.ts 가 막는다.

export const ROLES = ["owner", "admin", "team_lead", "member"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "소유자",
  admin: "관리자",
  team_lead: "팀장",
  member: "멤버",
};

// D24 — 조회 범위가 뷰보다 먼저 적용된다. 역할별 데이터 범위(표시용 · 실제 행 단위 시행은
// 기존 org_members.scope=all/assigned 및 후속 부서-스코프 작업 소관, 이 카드는 판정 로직만 소유).
export const ROLE_DATA_SCOPE_LABEL: Record<Role, string> = {
  owner: "전체",
  admin: "전체",
  team_lead: "내 부서 이하",
  member: "본인 담당분",
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
  {
    group: "재무",
    items: [
      { scopeKey: "finance.ledger_read", label: "원장 보기", description: "Case 원장의 금액과 상태를 조회합니다", danger: true, defaultAllowed: [true, true, true, false] },
      { scopeKey: "finance.ledger_manage", label: "원장 관리", description: "Case 원장 변경 권한입니다 · 실제 금액 쓰기는 별도 계약입니다", danger: true, defaultAllowed: [true, true, false, false] },
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
