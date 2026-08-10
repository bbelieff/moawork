import { describe, expect, it } from "vitest";
import { mutateContactPipeline } from "./contactPipelineActions";

describe("contact pipeline production rollout gate", () => {
  it("원자 request 저장소가 연결되기 전에는 성공을 만들지 않는다", async () => {
    const form = new FormData();
    form.set("dealId", "00000000-0000-4000-8000-000000000020");
    form.set("requestId", "00000000-0000-4000-8000-000000000030");
    form.set("operation", "move");
    form.set("kind", "lead_to_contact");
    await expect(mutateContactPipeline({ ok: false, message: "" }, form)).resolves.toEqual({
      ok: false,
      message: "안전한 중복 요청 처리가 준비된 뒤 사용할 수 있습니다.",
    });
  });
});
