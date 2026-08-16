import type { QuestDef } from "./quests";

export type AutomationQuestDef = QuestDef & {
  source: "automation";
  ruleId: string;
  why: string | null;
  hidden: boolean;
  completed: boolean;
  sortOrder: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The RPC is an authorization boundary. Fail closed when a deployment and the
 * app disagree about the row contract instead of silently dropping quests.
 */
export function parseAutomationQuestDefs(value: unknown): AutomationQuestDef[] | null {
  if (!Array.isArray(value)) return null;

  const quests: AutomationQuestDef[] = [];
  for (const row of value) {
    if (
      !isRecord(row)
      || typeof row.questKey !== "string"
      || typeof row.ruleId !== "string"
      || typeof row.title !== "string"
      || (row.description !== null && typeof row.description !== "string")
      || (row.why !== null && typeof row.why !== "string")
      || typeof row.hidden !== "boolean"
      || typeof row.completed !== "boolean"
      || typeof row.sortOrder !== "number"
      || !Number.isFinite(row.sortOrder)
      || !isRecord(row.judgeParams)
    ) {
      return null;
    }

    quests.push({
      questKey: row.questKey,
      ruleId: row.ruleId,
      title: row.title,
      description: row.description,
      why: row.why,
      hidden: row.hidden,
      completed: row.completed,
      sortOrder: row.sortOrder,
      source: "automation",
      judgeKind: "automation_rule_succeeded",
      judgeParams: row.judgeParams,
    });
  }

  return quests.sort((left, right) => left.sortOrder - right.sortOrder || left.questKey.localeCompare(right.questKey));
}
