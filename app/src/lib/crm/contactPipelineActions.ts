"use server";

export type ContactPipelineActionState = Readonly<{
  ok: boolean;
  message: string;
}>;

export const CONTACT_PIPELINE_ROLLOUT_BLOCKED_MESSAGE =
  "안전한 중복 요청 처리가 준비된 뒤 사용할 수 있습니다.";

export async function mutateContactPipeline(
  _previous: ContactPipelineActionState,
  _formData: FormData,
): Promise<ContactPipelineActionState> {
  void _previous;
  void _formData;
  // DB-backed atomic request reservation이 아직 source에 연결되지 않았다.
  // 기존 CRUD를 조합해 성공처럼 보이게 하지 않고 rollout을 명시적으로 닫는다.
  return { ok: false, message: CONTACT_PIPELINE_ROLLOUT_BLOCKED_MESSAGE };
}
