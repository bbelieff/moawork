/**
 * 권한 «판정 자체» 를 못 한 화면 (BBE-204).
 *
 * ★ 「권한이 없다」와 「권한을 확인 못 했다」는 다른 사실이다.
 *   `lib/perm/guard.ts` 는 처음부터 그 둘을 `reason: "permission" | "unavailable"` 로 나눠 내려보내고,
 *   그 파일 머리에 **「화면에서 달라야 한다」** 고 적혀 있다. 그런데 호출부가 그걸 안 읽고
 *   전부 `notFound()` 로 접었다 — 그래서 장애가 「그런 건 없습니다」로 보였다.
 *
 * ★ 접근 허용 범위는 한 글자도 넓히지 않는다. fail-closed 그대로다 —
 *   판정을 못 하면 여전히 못 들어간다. 바뀌는 것은 **「무엇이라고 말하는가」** 뿐이다.
 *
 * ★ 존재 숨김(existence hiding)도 그대로다. 이 화면은 **자원에 대해 아무것도 말하지 않는다** —
 *   보드가 있는지 없는지, 몇 개인지 전혀 드러내지 않고 «권한 조회가 실패했다» 만 말한다.
 *   그래서 `reason: "permission"` 은 종전대로 `notFound()` 로 남겨 둔다.
 *
 * 문구는 `PermissionMatrix` 가 이미 쓰던 것을 따른다(같은 사실에 같은 말).
 */
export function PermissionUnavailable() {
  return (
    <section
      role="alert"
      aria-labelledby="perm-unavailable-title"
      data-testid="perm-unavailable"
      className="rounded-md border p-5"
      style={{ borderColor: "var(--mw-error)", background: "var(--mw-card)" }}
    >
      <h1 id="perm-unavailable-title" className="text-lg font-semibold" style={{ color: "var(--mw-fg)" }}>
        권한을 확인하지 못했어요
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--mw-sub)" }}>
        잠시 후 다시 시도해 주세요. 문제가 계속되면 회사 관리자에게 알려 주세요.
      </p>
    </section>
  );
}
