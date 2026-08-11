import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JUDGES } from "./quests";

// BBE-113(GT07)이 기다리는 판정 계약: 마이그레이션이 심는 judge_kind 는 전부
// quests.ts 의 JUDGES 어휘 안에 있어야 한다. 어긋나면 씨드 퀘스트가 항상 미통과로 닫힌다.
const MIGRATION = join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "048_onboarding.sql");

describe("048_onboarding.sql 의 씨드 퀘스트 judge_kind 가 quests.ts 어휘 안에 있다", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const seedBlock = sql.slice(sql.indexOf("insert into public.onboarding_quest_defs"));
  const rowPattern = /\('([a-z0-9:_-]+)', '[^']*', '[^']*', '([a-z_]+)',/g;

  const seededJudgeKinds: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(seedBlock))) {
    seededJudgeKinds.push(match[2]);
  }

  it("씨드에서 judge_kind 를 파싱했다(파서 자체가 깨지지 않았는지 확인)", () => {
    expect(seededJudgeKinds.length).toBeGreaterThan(0);
  });

  it("씨드된 judge_kind 전부가 JUDGES 에 실제 구현돼 있다", () => {
    for (const kind of seededJudgeKinds) {
      expect(kind in JUDGES, `씨드가 쓰는 judge_kind "${kind}" 가 quests.ts 에 없다`).toBe(true);
    }
  });
});
