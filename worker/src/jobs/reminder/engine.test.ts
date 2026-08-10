import { describe, expect, it } from "vitest";
import { buildReminderJob, dueReminderJobs, reminderDate } from "./engine.js";

describe("D67 공용 날짜 알림", () => {
  it("재신청 안내일 15일 전에 담당자와 직속 상사에게 알린다", () => {
    const job = buildReminderJob({
      kind: "reapply",
      sourceId: "reject-1",
      companyId: "company-1",
      assigneeId: "user-1",
      supervisorId: "manager-1",
      dueDate: "2027-08-20",
      daysBefore: 15,
    });
    expect(job.notifyOn).toBe("2027-08-05");
    expect(job.recipientIds).toEqual(["user-1", "manager-1"]);
  });

  it("재접촉일·재신청일·예상 심사 종료일을 같은 엔진으로 처리한다", () => {
    const common = { companyId: "company-1", assigneeId: "user-1", dueDate: "2026-09-01", daysBefore: 0 };
    const jobs = dueReminderJobs(
      [
        { ...common, kind: "recontact", sourceId: "contact-1" },
        { ...common, kind: "reapply", sourceId: "reject-1" },
        { ...common, kind: "review_end", sourceId: "review-1" },
      ],
      "2026-09-01",
    );
    expect(jobs.map((job) => job.kind)).toEqual(["recontact", "reapply", "review_end"]);
  });

  it("이미 보낸 키와 중복 입력은 다시 발송 후보에 넣지 않는다", () => {
    const source = {
      kind: "reapply" as const,
      sourceId: "reject-1",
      companyId: "company-1",
      assigneeId: "user-1",
      dueDate: "2027-08-20",
      daysBefore: 15,
    };
    const key = buildReminderJob(source).key;
    expect(dueReminderJobs([source, source], "2027-08-05")).toHaveLength(1);
    expect(dueReminderJobs([source], "2027-08-05", new Set([key]))).toEqual([]);
  });

  it("월 경계를 넘겨도 날짜를 정확히 뺀다", () => {
    expect(reminderDate("2026-03-10", 15)).toBe("2026-02-23");
  });
});
