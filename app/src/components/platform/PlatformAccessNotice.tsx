type PlatformAccessError = "platform-forbidden" | "platform-unavailable";

const COPY: Record<PlatformAccessError, { title: string; message: string }> = {
  "platform-forbidden": {
    title: "관리자 모드를 사용할 권한이 없어요",
    message: "현재 계정은 플랫폼 관리자가 아닙니다. 사용자 모드에서 회사 업무를 계속할 수 있어요.",
  },
  "platform-unavailable": {
    title: "관리자 권한을 확인하지 못했어요",
    message: "권한 확인 서비스가 잠시 응답하지 않았습니다. 잠시 후 관리자 모드 진입을 다시 시도해 주세요.",
  },
};

export function PlatformAccessNotice({ error }: { error: unknown }) {
  if (error !== "platform-forbidden" && error !== "platform-unavailable") return null;
  const copy = COPY[error];
  return (
    <section
      role="alert"
      className="rounded-xl border px-4 py-3"
      style={{ background: "var(--mw-card)", borderColor: "var(--mw-line)" }}
    >
      <h2 className="font-semibold">{copy.title}</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--mw-sub)" }}>{copy.message}</p>
    </section>
  );
}
