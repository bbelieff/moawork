import { createClient } from "@/lib/supabase/server";
import { getBoardsRepo } from "@/lib/repo/local/boardsRepo";
import { installStructurePack } from "@/lib/structure-packs";
import type { Ctx, MemberRole, MemberScope, User } from "@/lib/types";
import { judgeQuest, type QuestDef } from "./quests";

export type QuestState = QuestDef & { completed: boolean };

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
 * 연습 회사를 확보하고(없으면 생성) 구조 팩까지 설치한다 — 처음 진입해도 클릭할
 * 구조가 바로 보여야 한다(카드 지시 "연습 회사도 개정된 목업과 같은 화면이어야 한다").
 * 실명·업체명은 심지 않는다 — `installStructurePack` 은 구조(보드·그룹·컬럼)만 만들고
 * 아이템(행)은 만들지 않는다(D71~D75 와 같은 원리, PLAN-002 §1 그대로).
 *
 * 실패는 곧 미제공으로 수렴한다 — 권한 모듈과 같은 원칙(perm/server.ts 참고):
 * 연습 회사도 조직 하나이므로 잘못 실패해서 화면이 열리면 안 된다.
 */
export async function ensurePracticeWorkspace(
  user: User,
): Promise<{ ok: true; orgId: string } | { ok: false }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ensure_my_practice_workspace");
    if (error || typeof data !== "string") {
      return { ok: false };
    }
    const orgId = data;
    try {
      installStructurePack(practiceCtx(orgId, user), { repo: getBoardsRepo() });
    } catch {
      // 구조 설치 실패는 연습 회사 확보 자체를 무효화하지 않는다 — 재시도 가능한 후속 조작이다.
    }
    return { ok: true, orgId };
  } catch {
    return { ok: false };
  }
}

/** 이 org_id 가 정말 호출자의 연습 회사인지 DB 에 재확인한다 — 화면 신뢰는 서버가 다시 검증한다. */
export async function isMyPracticeWorkspace(orgId: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("is_my_practice_workspace", { p_org_id: orgId });
    return !error && data === true;
  } catch {
    return false;
  }
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
    return evaluatePracticeQuests(data, user);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

async function loadQuestDefs(): Promise<QuestDef[] | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_onboarding_quests");
    if (error || !Array.isArray(data)) return null;
    return data as QuestDef[];
  } catch {
    return null;
  }
}

async function loadCompletedKeys(orgId: string): Promise<Set<string> | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("read_my_practice_progress", { p_org_id: orgId });
    if (error || !Array.isArray(data)) return null;
    return new Set(data.map((row: { questKey: string }) => row.questKey));
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
  const owns = await isMyPracticeWorkspace(orgId);
  if (!owns) {
    return { ok: false, reason: "permission" };
  }

  const [defs, completed] = await Promise.all([loadQuestDefs(), loadCompletedKeys(orgId)]);
  if (!defs || !completed) {
    return { ok: false, reason: "unavailable" };
  }

  const ctx = practiceCtx(orgId, user);
  const repo = getBoardsRepo();
  const quests: QuestState[] = [];

  for (const def of defs) {
    const alreadyCompleted = completed.has(def.questKey);
    const passesNow = alreadyCompleted || judgeQuest(ctx, repo, def);
    if (passesNow && !alreadyCompleted) {
      try {
        const supabase = await createClient();
        await supabase.rpc("record_quest_progress", { p_org_id: orgId, p_quest_key: def.questKey });
      } catch {
        // 기록 실패해도 이번 응답에서는 통과로 보여준다 — 다음 재판정에서 다시 기록을 시도한다.
      }
    }
    quests.push({ ...def, completed: passesNow });
  }

  return { ok: true, snapshot: { orgId, quests } };
}
