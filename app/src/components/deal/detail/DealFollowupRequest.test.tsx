import { describe, expect, it } from "vitest";
import { followupUiResult } from "./DealFollowupRequest";

describe("DealFollowupRequest outcome handling", () => {
  it("closes and clears only after the notification was actually sent", () => {
    expect(followupUiResult({ status: "sent" })).toEqual({
      close: true,
      clearReason: true,
      sent: true,
      error: null,
    });
  });

  it.each(["no_assignee", "self_assigned", "rpc_error"] as const)(
    "keeps the form and reason on %s",
    (reason) => {
      expect(
        followupUiResult({ status: "not_sent", reason, message: "전달 실패" }),
      ).toEqual({
        close: false,
        clearReason: false,
        sent: false,
        error: "전달 실패",
      });
    },
  );
});
