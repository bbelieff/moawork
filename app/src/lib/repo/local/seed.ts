import type { Db } from "./store";
import { MVP_ENABLED_FEATURES } from "@/lib/product";

// 로컬 개발용 시드 데이터. 고정 id 를 써서 ?as=member 스코프 데모 등이 재현 가능하게 한다.
// 구성: 데모 조직 1개 · 사용자 3명(owner/admin/member) · 파이프라인 5단계 ·
//       고객사/딜은 담당자를 나눠 배치(멤버 담당범위 격리 시연).

const TS = "2026-07-21T00:00:00.000Z";

export const SEED_ORG_ID = "org00000-0000-0000-0000-000000000001";
export const SEED_USER_OWNER = "usr00000-0000-0000-0000-0000000000a1";
export const SEED_USER_ADMIN = "usr00000-0000-0000-0000-0000000000a2";
export const SEED_USER_MEMBER = "usr00000-0000-0000-0000-0000000000a3";
const PIPE_ID = "pip00000-0000-0000-0000-000000000001";

// 003 임의 보드 시드 id (ADR-0003)
export const SEED_BOARD_PIPELINE = "brd00000-0000-0000-0000-000000000001";
export const SEED_BOARD_TASKS = "brd00000-0000-0000-0000-000000000002";

export function seedDb(): Db {
  const users = [
    {
      id: SEED_USER_OWNER,
      email: "owner@demo.moawork",
      name: "오너",
      avatar_url: null,
      created_at: TS,
    },
    {
      id: SEED_USER_ADMIN,
      email: "admin@demo.moawork",
      name: "관리자",
      avatar_url: null,
      created_at: TS,
    },
    {
      id: SEED_USER_MEMBER,
      email: "member@demo.moawork",
      name: "담당멤버",
      avatar_url: null,
      created_at: TS,
    },
  ];

  const stageDefs: Array<[string, string, Db["stages"][number]["kind"]]> = [
    ["stg00000-0000-0000-0000-000000000001", "마케팅", "marketing"],
    ["stg00000-0000-0000-0000-000000000002", "미팅", "meeting"],
    ["stg00000-0000-0000-0000-000000000003", "계약", "contract"],
    ["stg00000-0000-0000-0000-000000000004", "실무", "work"],
    ["stg00000-0000-0000-0000-000000000005", "정산", "settle"],
  ];

  const stages = stageDefs.map(([id, name, kind], i) => ({
    id,
    pipeline_id: PIPE_ID,
    name,
    sort_order: i,
    kind,
  }));

  const companies = [
    {
      id: "cmp00000-0000-0000-0000-000000000001",
      org_id: SEED_ORG_ID,
      name: "가나다상사",
      biz_type: "제조",
      region: "서울 강남구",
      owner_name: "김대표",
      phone: null,
      email: null,
      revenue: 1200000000,
      founded_on: "2018-03-01",
      homepage: null,
      assigned_to: SEED_USER_MEMBER,
      created_at: TS,
    },
    {
      id: "cmp00000-0000-0000-0000-000000000002",
      org_id: SEED_ORG_ID,
      name: "라마바테크",
      biz_type: "IT",
      region: "경기 성남시",
      owner_name: "이대표",
      phone: null,
      email: null,
      revenue: 450000000,
      founded_on: "2020-07-01",
      homepage: null,
      assigned_to: SEED_USER_ADMIN,
      created_at: TS,
    },
  ];

  const deals = [
    {
      id: "del00000-0000-0000-0000-000000000001",
      org_id: SEED_ORG_ID,
      company_id: companies[0].id,
      pipeline_id: PIPE_ID,
      stage_id: stages[1].id, // 미팅
      assigned_to: SEED_USER_MEMBER,
      title: "가나다상사 운전자금",
      amount: 300000000,
      status_note: null,
      applied_on: "2026-07-10",
      custom: {},
      created_at: TS,
      updated_at: TS,
    },
    {
      id: "del00000-0000-0000-0000-000000000002",
      org_id: SEED_ORG_ID,
      company_id: companies[1].id,
      pipeline_id: PIPE_ID,
      stage_id: stages[2].id, // 계약
      assigned_to: SEED_USER_ADMIN,
      title: "라마바테크 시설자금",
      amount: 500000000,
      status_note: null,
      applied_on: "2026-07-12",
      custom: {},
      created_at: TS,
      updated_at: TS,
    },
    {
      id: "del00000-0000-0000-0000-000000000003",
      org_id: SEED_ORG_ID,
      company_id: companies[0].id,
      pipeline_id: PIPE_ID,
      stage_id: stages[0].id, // 마케팅
      assigned_to: SEED_USER_MEMBER,
      title: "가나다상사 정책자금 상담",
      amount: null,
      status_note: null,
      applied_on: null,
      custom: {},
      created_at: TS,
      updated_at: TS,
    },
  ];

  // ── 003 사용자 임의 보드 엔진 시드 (ADR-0003) ──
  // 시스템 보드 1개(정책자금 파이프라인 = 001 deals 로 렌더, 여기엔 메타만) +
  // 사용자 보드 1개(컬럼/그룹/아이템/셀 값 예시, 담당범위 시연).
  const boards = [
    {
      id: SEED_BOARD_PIPELINE,
      org_id: SEED_ORG_ID,
      name: "정책자금 파이프라인",
      description: "신규고객 → 컨텍 → 업무 → 회계 (typed 코어: deals/stages/settlements)",
      icon: "🏦",
      is_system: true,
      source: "core.crm.pipeline",
      sort_order: 0,
      created_by: null,
      created_at: TS,
      updated_at: TS,
    },
    {
      id: SEED_BOARD_TASKS,
      org_id: SEED_ORG_ID,
      name: "업무 요청",
      description: "예시 사용자 보드 — 컬럼·행을 자유롭게 추가",
      icon: "📋",
      is_system: false,
      source: null,
      sort_order: 1,
      created_by: SEED_USER_OWNER,
      created_at: TS,
      updated_at: TS,
    },
  ];

  const boardGroups = [
    { id: "bgr00000-0000-0000-0000-000000000001", org_id: SEED_ORG_ID, board_id: SEED_BOARD_TASKS, name: "이번 주", color: "#579bfc", sort_order: 0 },
    { id: "bgr00000-0000-0000-0000-000000000002", org_id: SEED_ORG_ID, board_id: SEED_BOARD_TASKS, name: "다음 주", color: "#a25ddc", sort_order: 1 },
  ];

  const boardColumns = [
    {
      id: "bcl00000-0000-0000-0000-000000000001",
      org_id: SEED_ORG_ID,
      board_id: SEED_BOARD_TASKS,
      key: "status",
      label: "상태",
      type: "select" as const,
      options_jsonb: {
        options: [
          { id: "opt-todo", label: "대기", color: "#c4c4c4", order: 0 },
          { id: "opt-doing", label: "진행중", color: "#fdab3d", order: 1 },
          { id: "opt-done", label: "완료", color: "#00c875", order: 2 },
        ],
      },
      sort_order: 0,
      width: 140,
    },
    {
      id: "bcl00000-0000-0000-0000-000000000002",
      org_id: SEED_ORG_ID,
      board_id: SEED_BOARD_TASKS,
      key: "owner",
      label: "담당",
      type: "person" as const,
      options_jsonb: null,
      sort_order: 1,
      width: 120,
    },
    {
      id: "bcl00000-0000-0000-0000-000000000003",
      org_id: SEED_ORG_ID,
      board_id: SEED_BOARD_TASKS,
      key: "due",
      label: "마감일",
      type: "date" as const,
      options_jsonb: null,
      sort_order: 2,
      width: 130,
    },
    {
      id: "bcl00000-0000-0000-0000-000000000004",
      org_id: SEED_ORG_ID,
      board_id: SEED_BOARD_TASKS,
      key: "note",
      label: "메모",
      type: "text" as const,
      options_jsonb: null,
      sort_order: 3,
      width: null,
    },
  ];

  const boardItems = [
    { id: "itm00000-0000-0000-0000-000000000001", org_id: SEED_ORG_ID, board_id: SEED_BOARD_TASKS, group_id: boardGroups[0].id, title: "사업자등록증 수집", assigned_to: SEED_USER_MEMBER, sort_order: 0, created_at: TS, updated_at: TS },
    { id: "itm00000-0000-0000-0000-000000000002", org_id: SEED_ORG_ID, board_id: SEED_BOARD_TASKS, group_id: boardGroups[0].id, title: "재무제표 검토", assigned_to: SEED_USER_ADMIN, sort_order: 1, created_at: TS, updated_at: TS },
    { id: "itm00000-0000-0000-0000-000000000003", org_id: SEED_ORG_ID, board_id: SEED_BOARD_TASKS, group_id: boardGroups[1].id, title: "보증서 발급 문의", assigned_to: SEED_USER_MEMBER, sort_order: 2, created_at: TS, updated_at: TS },
  ];

  const itemValues = [
    { org_id: SEED_ORG_ID, item_id: boardItems[0].id, column_key: "status", value_jsonb: "opt-doing" },
    { org_id: SEED_ORG_ID, item_id: boardItems[0].id, column_key: "owner", value_jsonb: SEED_USER_MEMBER },
    { org_id: SEED_ORG_ID, item_id: boardItems[0].id, column_key: "due", value_jsonb: "2026-07-25" },
    { org_id: SEED_ORG_ID, item_id: boardItems[1].id, column_key: "status", value_jsonb: "opt-todo" },
    { org_id: SEED_ORG_ID, item_id: boardItems[1].id, column_key: "due", value_jsonb: "2026-07-28" },
    { org_id: SEED_ORG_ID, item_id: boardItems[2].id, column_key: "status", value_jsonb: "opt-done" },
    { org_id: SEED_ORG_ID, item_id: boardItems[2].id, column_key: "note", value_jsonb: "지역 보증재단 확인 완료" },
  ];

  return {
    orgs: [
      {
        id: SEED_ORG_ID,
        name: "모아워크 데모 조직",
        plan_tier: "t1_3",
        created_at: TS,
      },
    ],
    users,
    members: [
      {
        org_id: SEED_ORG_ID,
        user_id: SEED_USER_OWNER,
        role: "owner",
        scope: "all",
        created_at: TS,
      },
      {
        org_id: SEED_ORG_ID,
        user_id: SEED_USER_ADMIN,
        role: "admin",
        scope: "all",
        created_at: TS,
      },
      {
        org_id: SEED_ORG_ID,
        user_id: SEED_USER_MEMBER,
        role: "member",
        scope: "assigned",
        created_at: TS,
      },
    ],
    entitlements: MVP_ENABLED_FEATURES.map((feature_key) => ({
      org_id: SEED_ORG_ID,
      feature_key,
      enabled: true,
      limit_value: null,
      source: "plan" as const,
      expires_at: null,
    })),
    companies,
    pipelines: [{ id: PIPE_ID, org_id: SEED_ORG_ID, name: "기본 파이프라인" }],
    stages,
    deals,
    activities: [],
    fieldDefs: [],
    fieldValues: [],
    savedViews: [],
    // 정산은 시드 없음 — T09 가 딜 진행에 따라 생성한다.
    settlements: [],
    boards,
    boardGroups,
    boardColumns,
    boardItems,
    itemValues,
    boardViews: [],
  };
}
