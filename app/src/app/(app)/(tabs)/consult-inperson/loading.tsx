import { RouteLoading } from "@/components/shell/RouteLoading";

// 경유지 — page.tsx 가 같은 리드컨택 정본 보드의 대면 단계 보기로 redirect 한다.
export default function ConsultInpersonLoading() {
  return <RouteLoading label="대면 상담 보기를 여는 중이에요." />;
}
