import { noticeLive, noticeRole, type ResultNotice } from "./result-notice";

/**
 * 액션 결과 배너 (BBE-208).
 *
 * ★ 왜 부품으로 뽑았나 — 「소스에 그렇게 쓰여 있다」와 「그렇게 그려진다」는 다르다.
 *   오늘 그 틈이 두 번 벌어졌다:
 *     · BBE-199 이니셜 마크 — `<span>{initial}</span>` 은 있었는데 흰 글자 + 투명 배경이라 «안 보였다»
 *     · BBE-212 칸반 배너   — 배너 코드는 있었는데 뷰 분기 밖이라 «안 그려졌다»
 *   이 카드의 주제가 「사용자·보조기술이 무엇을 인지하는가」라서, 검사가 소스에서 멈추면 안 된다.
 *   부품으로 뽑으면 «그려진 마크업» 을 직접 잴 수 있다.
 *
 * ★ role 과 색이 «한 곳에서 함께» 판정을 읽는다. 채널을 각각 쓰면 한쪽만 고쳐진다 —
 *   WorkspaceEntry 가 색만 읽고 role 을 안 읽던 자리였다.
 */
export function ResultBanner({
  notice,
  okClassName,
  errorClassName,
}: {
  notice: ResultNotice;
  okClassName?: string;
  errorClassName?: string;
}) {
  return (
    <p
      className={notice.ok ? okClassName : errorClassName}
      role={noticeRole(notice.ok)}
      aria-live={noticeLive(notice.ok)}
    >
      {notice.message}
    </p>
  );
}
