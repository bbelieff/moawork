import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx, MemberRole, MemberScope, User } from "@/lib/types";
import { SupabaseBoardsRepo } from "@/lib/repo/supabase/boardsRepo";
import { parseAutomationQuestDefs, type AutomationQuestDef } from "./automation-quests";
import { judgeQuest, type QuestDef } from "./quests";

export type QuestState = QuestDef & {
  completed: boolean;
  source?: "manual" | "automation";
  ruleId?: string;
  why?: string | null;
  hidden?: boolean;
  sortOrder?: number;
};

export type PracticeSnapshot = {
  orgId: string;
  quests: QuestState[];
};

function practiceCtx(orgId: string, user: User): Ctx {
  return {
    user,
    org: { id: orgId, name: "연습 회사", plan_tier: "t1_3", created_at: "" },
    role: "owner" as MemberRole,
    scope: "all" as MemberScope,
  };
}

/**
 * BBE-156 계약: 연습 회사는 고객 전용 먼데이 구조를 제품 기본값으로 설치하지 않는다.
 * 새 회사와 같은 빈 제품 상태를 유지한다.
 */

/**
 * 연습 회사를 확보하고(없으면 생성) 구조 팩까지 설치한다 — 처음 진입해도 클릭할
 * 구조가 바로 보여야 한다(카드 지시 "연습 회사도 개정된 목업과 같은 화면이어야 한다").
 * 실명·업체명은 심지 않는다 — `installStructurePack` 은 구조(보드·그룹·컬럼)만 만들고
 * 아이템(행)은 만들지 않는다(D71~D75 와 같은 원리, PLAN-002 §1 그대로).
 *
 * 실패는 곧 미제공으로 수렴한다 — 권한 모듈과 같은 원칙(perm/server.ts 참고):
 * 연습 회사도 조직 하나이므로 잘못 실패해서 화면이 열리면 안 된다.
 */
export async function ensurePracticeWorkspace(
  _user: User,
): Promise<{ ok: true; orgId: string } | { ok: false }> {
  void _user;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ensure_my_practice_workspace");
    if (error || typeof data !== "string") {
      return { ok: false };
    }
    return { ok: true, orgId: data };
  } catch {
    return { ok: false };
  }
}

/** 이 org_id 가 정말 호출자의 연습 회사인지 DB 에 재확인한다 — 화면 신뢰는 서버가 다시 검증한다. */
export async function isMyPracticeWorkspace(orgId: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    return isPracticeWorkspaceWithClient(supabase, orgId);
  } catch {
    return false;
  }
}

async function isPracticeWorkspaceWithClient(client: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await client.rpc("is_my_practice_workspace", { p_org_id: orgId });
  return !error && data === true;
}

/** 페이지 진입 시 기존 연습 회사만 읽는다. 없으면 생성하지 않고 시작 화면을 반환한다. */
export async function loadMyPracticeSnapshot(
  user: User,
): Promise<{ ok: true; snapshot: PracticeSnapshot | null } | { ok: false; reason: "permission" | "unavailable" }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("read_my_practice_workspace");
    if (error) return { ok: false, reason: "unavailable" };
    if (data === null) return { ok: true, snapshot: null };
    if (typeof data !== "string") return { ok: false, reason: "unavailable" };
    return evaluatePracticeQuestsWithClient(supabase, data, user);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

async function loadQuestDefs(client: SupabaseClient): Promise<QuestDef[] | null> {
  try {
    const { data, error } = await client.rpc("list_onboarding_quests");
    if (error || !Array.isArray(data)) return null;
    return data as QuestDef[];
  } catch {
    return null;
  }
}

async function loadCompletedKeys(client: SupabaseClient, orgId: string): Promise<Set<string> | null> {
  try {
    const { data, error } = await client.rpc("read_my_practice_progress", { p_org_id: orgId });
    if (error || !Array.isArray(data)) return null;
    return new Set(data.map((row: { questKey: string }) => row.questKey));
  } catch {
    return null;
  }
}

async function loadAutomationQuestDefs(client: SupabaseClient, orgId: string): Promise<AutomationQuestDef[] | null> {
  try {
    const { data, error } = await client.rpc("sync_my_automation_onboarding_quests", { p_org_id: orgId });
    if (error) return null;
    return parseAutomationQuestDefs(data);
  } catch {
    return null;
  }
}

/**
 * 퀘스트 카탈로그를 현재 연습 회사 상태로 실제 판정하고, 방금 새로 통과한 것만
 * `record_quest_progress` 로 기록한다. 이미 기록된 퀘스트는 다시 쓰지 않는다
 * (최초 통과 시각을 보존 — 재판정마다 시각이 밀리면 «언제 배웠는지» 기록이 거짓말이 된다).
 */
export async function evaluatePracticeQuests(
  orgId: string,
  user: User,
): Promise<{ ok: true; snapshot: PracticeSnapshot } | { ok: false; reason: "permission" | "unavailable" }> {
  try {
    const client = await createClient();
    return evaluatePracticeQuestsWithClient(client, orgId, user);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

async function evaluatePracticeQuestsWithClient(
  client: SupabaseClient,
  orgId: string,
  user: User,
): Promise<{ ok: true; snapshot: PracticeSnapshot } | { ok: false; reason: "permission" | "unavailable" }> {
  const owns = await isPracticeWorkspaceWithClient(client, orgId);
  if (!owns) {
    return { ok: false, reason: "permission" };
  }

  const [defs, completed, automationDefs] = await Promise.all([
    loadQuestDefs(client),
    loadCompletedKeys(client, orgId),
    loadAutomationQuestDefs(client, orgId),
  ]);
  if (!defs || !completed || !automationDefs) {
    return { ok: false, reason: "unavailable" };
  }

  const ctx = practiceCtx(orgId, user);
  const repo = new SupabaseBoardsRepo(client);
  const quests: QuestState[] = [];

  for (const def of defs) {
    const alreadyCompleted = completed.has(def.questKey);
    const passesNow = alreadyCompleted || await judgeQuest(ctx, repo, def);
    if (passesNow && !alreadyCompleted) {
      try {
        await client.rpc("record_quest_progress", { p_org_id: orgId, p_quest_key: def.questKey });
      } catch {
        // 기록 실패해도 이번 응답에서는 통과로 보여준다 — 다음 재판정에서 다시 기록을 시도한다.
      }
    }
    quests.push({ ...def, completed: passesNow, source: "manual" });
  }

  quests.push(...automationDefs);

  return { ok: true, snapshot: { orgId, quests } };
}

export async function updateAutomationQuestPreferences(input: {
  orgId: string;
  ruleId: string;
  hidden: boolean;
  why: string;
}): Promise<{ ok: true } | { ok: false }> {
  try {
    const client = await createClient();
    const { error } = await client.rpc("update_my_automation_onboarding_quest", {
      p_org_id: input.orgId,
      p_rule_id: input.ruleId,
      p_hidden: input.hidden,
      p_why: input.why,
    });
    return error ? { ok: false } : { ok: true };
  } catch {
    return { ok: false };
  }
}
