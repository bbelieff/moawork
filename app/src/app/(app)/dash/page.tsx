import { redirect } from "next/navigation";

/**
 * 「업무 분석」은 «홈 한 화면 아래» 의 「회사 현황」 절이 됐다(BBE-215 · 총괄 확정).
 *
 * ★ 이 파일을 «지우지» 않고 리다이렉트로 남기는 이유 — 이 주소는 «잎» 이 아니라 «입구» 였다.
 *   위젯이 자식 화면으로 가는 «유일한» 링크를 들고 있었다:
 *     /dash/all · /dash/all?range=month · /dash/all?range=month&paid=1 · /dash/[pipelineId]
 *   위젯이 홈으로 옮겨갔으니 그 링크도 같이 옮겨갔고, 자식 세 화면은 «그대로 살아 있다».
 *   그런데 `/dash` 자체는 여전히 밖에서 가리켜진다:
 *     · components/shell/app-tabs.ts 의 OUT_OF_TAB_HREFS 등록
 *     · lib/analytics 의 isGated("/dash")
 *     · 사용자 북마크·기존 링크(우리가 셀 수 없다)
 *   지우면 그것들이 404 가 된다. 리다이렉트는 그 전부를 홈으로 데려간다.
 *
 * ★ 「들어오는 링크가 몇 개인가」만 세면 이 판단을 못 한다. 「이 화면이 무엇을 가리키는가」도
 *   물어야 «입구» 를 «잎» 으로 오인하지 않는다.
 */
export default function DashRedirectPage() {
  redirect("/");
}
