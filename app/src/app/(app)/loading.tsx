import { RouteLoading } from "@/components/shell/RouteLoading";

// Issue 857 — 앱 화면 전체의 기본 로딩 경계. 대시보드(/)가 직접 쓰고, 자기 loading.tsx 가 없는
// 화면도 클릭 즉시 이 표시가 뜬다(전에는 서버가 다 읽을 때까지 이전 화면이 멈춘 듯 서 있었다).
export default function AppLoading() {
  return <RouteLoading label="화면을 불러오는 중이에요." />;
}
