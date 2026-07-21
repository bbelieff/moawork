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
  };
}
