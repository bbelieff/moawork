import { RouteLoading } from "@/components/shell/RouteLoading";

// Issue 857 — 이 화면은 서버에서 읽을 것이 있어 클릭 뒤 본문이 비는 구간이 있다. 누른 즉시 알린다.
export default function DealLoading() {
  return <RouteLoading label="거래 상세를 불러오는 중이에요." />;
}
