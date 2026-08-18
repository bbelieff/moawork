import { RouteLoading } from "@/components/shell/RouteLoading";

// 이 라우트는 «화면» 이 아니라 보드로 보내는 경유지다(page.tsx 가 redirect 한다).
// 경유지도 서버 왕복을 한 벌 태우므로 그동안 본문이 비어 있었다 — BBE-214.
export default function NewCustomerLoading() {
  return <RouteLoading label="신규리드 보드를 여는 중이에요." />;
}
