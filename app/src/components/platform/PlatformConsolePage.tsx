import { PlatformAggregatePanel, PlatformShell } from "./PlatformShell";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { type PlatformSectionKey } from "@/lib/platform/contracts";
import { loadPlatformAggregate } from "@/lib/platform/server";

const COPY: Record<PlatformSectionKey, { title: string; description: string }> = {
  overview: { title: "운영 개요", description: "플랫폼 전체의 안전한 집계와 연결 상태를 확인해요." },
  organizations: { title: "조직", description: "조직 이름이나 구성원 목록 없이 연결 가능한 메타데이터만 다뤄요." },
  billing: { title: "결제·매출", description: "결제 원본이나 세무 정보 없이 집계 계약의 상태만 보여줘요." },
  access: { title: "접근 기록", description: "개인 활동 원본이 아닌 감사 가능한 메타데이터만 표시해요." },
  support: { title: "지원", description: "지원 확인은 읽기 전용으로만 제공돼요." },
  analytics: { title: "운영 분석", description: "집계 계약이 준비된 뒤에만 실제 운영 지표를 표시해요." },
  system: { title: "시스템", description: "운영 연결 상태를 확인하되 고객 데이터는 읽지 않아요." },
  admins: { title: "어드민 관리", description: "권한 변경은 별도 보안 계약이 연결될 때까지 제공하지 않아요." },
  demo: { title: "데모 워크스페이스", description: "검토된 내부 데모 환경은 별도 탭에서 확인해요." },
};

export async function PlatformConsolePage({ section, pathname }: { section: PlatformSectionKey; pathname: string }) {
  await requirePlatformAccess(pathname);
  const copy = COPY[section];
  const aggregate = await loadPlatformAggregate(section);
  return <PlatformShell pathname={pathname} title={copy.title} description={copy.description} userModeAction={{ mode: "user" }}><PlatformAggregatePanel section={section} state={aggregate} /></PlatformShell>;
}
