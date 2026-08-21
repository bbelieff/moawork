import { RouteLoading } from "@/components/shell/RouteLoading";

// 경유지 — page.tsx 가 보드로 redirect 한다. 총괄 스크린샷의 «빈 본문» 이 이 구간이다(BBE-214).
export default function ContactBoardLoading() {
  return <RouteLoading label="리드컨택 보드를 여는 중이에요." />;
}
