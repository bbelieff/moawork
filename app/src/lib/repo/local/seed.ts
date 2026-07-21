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
// 공지사항 보드 (T04 · core.notice) — 003 보드 엔진 위에 저장, 전용 테이블 없음.
export const SEED_BOARD_NOTICE = "brd00000-0000-0000-0000-000000000003";

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
    {
      // 공지사항 — is_system=false 로 둔다(true 면 보드 서비스가 아이템 편집을 막아 CRUD 불가).
      // source 로 시스템 성격을 표시하고, 화면은 /notices 전용 UI 로 렌더한다.
      id: SEED_BOARD_NOTICE,
      org_id: SEED_ORG_ID,
      name: "공지사항",
      description: "조직 전체 공지 — 상단고정 공지가 먼저 보입니다",
      icon: "📢",
      is_system: false,
      source: "core.notice",
      sort_order: 2,
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
    // ── 공지사항 보드 컬럼 (T04) — @/lib/notices/types.ts NOTICE_COLUMNS 와 동일 정의 ──
    {
      id: "bcl00000-0000-0000-0000-000000000011",
      org_id: SEED_ORG_ID,
      board_id: SEED_BOARD_NOTICE,
      key: "body",
      label: "본문",
      type: "longtext" as const,
      options_jsonb: null,
      sort_order: 0,
      width: null,
    },
    {
      id: "bcl00000-0000-0000-0000-000000000012",
      org_id: SEED_ORG_ID,
      board_id: SEED_BOARD_NOTICE,
      key: "category",
      label: "분류",
      type: "select" as const,
      options_jsonb: {
        options: [
          { id: "notice-general", label: "일반", color: "#579bfc", order: 0 },
          { id: "notice-important", label: "중요", color: "#e2445c", order: 1 },
          { id: "notice-event", label: "행사", color: "#00c875", order: 2 },
        ],
      },
      sort_order: 1,
      width: 110,
    },
    {
      id: "bcl00000-0000-0000-0000-000000000013",
      org_id: SEED_ORG_ID,
      board_id: SEED_BOARD_NOTICE,
      key: "pinned",
      label: "상단고정",
      type: "checkbox" as const,
      options_jsonb: null,
      sort_order: 2,
      width: 90,
    },
    {
      id: "bcl00000-0000-0000-0000-000000000014",
      org_id: SEED_ORG_ID,
      board_id: SEED_BOARD_NOTICE,
      key: "published_at",
      label: "게시일",
      type: "date" as const,
      options_jsonb: null,
      sort_order: 3,
      width: 130,
    },
    {
      id: "bcl00000-0000-0000-0000-000000000015",
      org_id: SEED_ORG_ID,
      board_id: SEED_BOARD_NOTICE,
      key: "author",
      label: "작성자",
      type: "person" as const,
      options_jsonb: null,
      sort_order: 4,
      width: 120,
    },
  ];

  const boardItems = [
    { id: "itm00000-0000-0000-0000-000000000001", org_id: SEED_ORG_ID, board_id: SEED_BOARD_TASKS, group_id: boardGroups[0].id, title: "사업자등록증 수집", assigned_to: SEED_USER_MEMBER, sort_order: 0, created_at: TS, updated_at: TS },
    { id: "itm00000-0000-0000-0000-000000000002", org_id: SEED_ORG_ID, board_id: SEED_BOARD_TASKS, group_id: boardGroups[0].id, title: "재무제표 검토", assigned_to: SEED_USER_ADMIN, sort_order: 1, created_at: TS, updated_at: TS },
    { id: "itm00000-0000-0000-0000-000000000003", org_id: SEED_ORG_ID, board_id: SEED_BOARD_TASKS, group_id: boardGroups[1].id, title: "보증서 발급 문의", assigned_to: SEED_USER_MEMBER, sort_order: 2, created_at: TS, updated_at: TS },
  ];

  // 공지사항 아이템 (T04). assigned_to=null — 공지는 개인이 아니라 조직에 속한다.
  // ⚠ 003 items RLS/로컬 repo 는 member+scope='assigned' 에게 assigned_to=본인 인 행만 보여준다
  //    → 그 사용자에게는 공지가 보이지 않는다(DQ-0018 로 기획 판정 요청 중).
  const noticeItems = [
    { id: "itm00000-0000-0000-0000-000000000011", org_id: SEED_ORG_ID, board_id: SEED_BOARD_NOTICE, group_id: null, title: "7월 정책자금 상담 일정 안내", assigned_to: null, sort_order: 0, created_at: TS, updated_at: TS },
    { id: "itm00000-0000-0000-0000-000000000012", org_id: SEED_ORG_ID, board_id: SEED_BOARD_NOTICE, group_id: null, title: "[중요] 계약서 양식 개정 (7/25 시행)", assigned_to: null, sort_order: 1, created_at: TS, updated_at: TS },
    { id: "itm00000-0000-0000-0000-000000000013", org_id: SEED_ORG_ID, board_id: SEED_BOARD_NOTICE, group_id: null, title: "하반기 워크숍 참가 신청", assigned_to: null, sort_order: 2, created_at: TS, updated_at: TS },
  ];

  const noticeValues = [
    { org_id: SEED_ORG_ID, item_id: noticeItems[0].id, column_key: "body", value_jsonb: "7월 정책자금 상담은 매주 화·목 오후에 진행합니다. 상담 예약은 담당자에게 문의하세요." },
    { org_id: SEED_ORG_ID, item_id: noticeItems[0].id, column_key: "category", value_jsonb: "notice-general" },
    { org_id: SEED_ORG_ID, item_id: noticeItems[0].id, column_key: "pinned", value_jsonb: false },
    { org_id: SEED_ORG_ID, item_id: noticeItems[0].id, column_key: "published_at", value_jsonb: "2026-07-15" },
    { org_id: SEED_ORG_ID, item_id: noticeItems[0].id, column_key: "author", value_jsonb: SEED_USER_ADMIN },

    { org_id: SEED_ORG_ID, item_id: noticeItems[1].id, column_key: "body", value_jsonb: "표준 계약서 양식이 개정되었습니다. 7/25 이후 체결 건부터 신규 양식을 사용하세요." },
    { org_id: SEED_ORG_ID, item_id: noticeItems[1].id, column_key: "category", value_jsonb: "notice-important" },
    { org_id: SEED_ORG_ID, item_id: noticeItems[1].id, column_key: "pinned", value_jsonb: true },
    { org_id: SEED_ORG_ID, item_id: noticeItems[1].id, column_key: "published_at", value_jsonb: "2026-07-18" },
    { org_id: SEED_ORG_ID, item_id: noticeItems[1].id, column_key: "author", value_jsonb: SEED_USER_OWNER },

    { org_id: SEED_ORG_ID, item_id: noticeItems[2].id, column_key: "body", value_jsonb: "하반기 워크숍을 8월 중 진행합니다. 참가 희망자는 이번 주까지 신청해 주세요." },
    { org_id: SEED_ORG_ID, item_id: noticeItems[2].id, column_key: "category", value_jsonb: "notice-event" },
    { org_id: SEED_ORG_ID, item_id: noticeItems[2].id, column_key: "pinned", value_jsonb: false },
    { org_id: SEED_ORG_ID, item_id: noticeItems[2].id, column_key: "published_at", value_jsonb: "2026-07-20" },
    { org_id: SEED_ORG_ID, item_id: noticeItems[2].id, column_key: "author", value_jsonb: SEED_USER_ADMIN },
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
    boardItems: [...boardItems, ...noticeItems],
    itemValues: [...itemValues, ...noticeValues],
    boardViews: [],
  };
}
