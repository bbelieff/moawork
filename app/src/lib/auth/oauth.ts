/** 외부 URL과 프로토콜 상대 URL을 막고 앱 내부 경로만 허용한다. */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;

  try {
    const url = new URL(path, "https://moa-work.local");
    return url.origin === "https://moa-work.local"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  auth: "Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.",
  config: "로그인 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
  membership: "연결된 워크스페이스가 없습니다. 관리자에게 초대를 요청해 주세요.",
  profile: "사용자 프로필을 준비하지 못했습니다. 다시 로그인해 주세요.",
  provisioning: "워크스페이스 권한을 준비하지 못했습니다. 다시 시도해 주세요.",
};
