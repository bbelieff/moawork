import type { PracticeSnapshot } from "./server";

export const AUTOMATION_QUEST_VISUAL_FIXTURE: PracticeSnapshot = {
  orgId: "00000000-0000-4000-8000-000000000113",
  quests: [
    {
      questKey: "automation-rule:00000000-0000-4000-8000-000000000001",
      ruleId: "00000000-0000-4000-8000-000000000001",
      title: "상담 상황을(를) “2차 상담예약” 상태로 바꾸기",
      description: "2차 상담예약 상태가 되면 2차 상담 고객 단계로 자동 이동해요.",
      why: "담당자가 바뀌어도 다음 상담 단계와 인계 시점을 놓치지 않기 위해 필요해요.",
      hidden: false,
      source: "automation",
      judgeKind: "automation_rule_succeeded",
      judgeParams: { ruleId: "00000000-0000-4000-8000-000000000001" },
      completed: false,
      sortOrder: 20001,
    },
    {
      questKey: "automation-rule:00000000-0000-4000-8000-000000000002",
      ruleId: "00000000-0000-4000-8000-000000000002",
      title: "승인 상태를(를) “승인 완료” 상태로 바꾸기",
      description: "승인 완료 상태가 되면 계약 준비 단계로 자동 이동해요.",
      why: null,
      hidden: true,
      source: "automation",
      judgeKind: "automation_rule_succeeded",
      judgeParams: { ruleId: "00000000-0000-4000-8000-000000000002" },
      completed: true,
      sortOrder: 30001,
    },
  ],
};
