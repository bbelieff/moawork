import { PlatformFixtureClient } from "./PlatformFixtureClient";
import { PlatformShell } from "@/components/platform/PlatformShell";

/**
 * 플랫폼 고객 운영 가상 보기. 실제 고객 데이터를 읽지 않고(플랫폼 가드를
 * 우회하지 않고) 합성 props만으로 목록·상세를 보여준다. 쓰기 호출은
 * 클라이언트의 로컬 가짜 응답으로만 답해 운영에 닿지 않는다.
 */
export default async function PlatformFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "detail" ? "detail" : "list";
  return (
    <PlatformShell pathname="/platform/organizations" title={view === "list" ? "고객사 관리" : "가상고객사 다람쥐"} description="">
      <PlatformFixtureClient view={view} />
    </PlatformShell>
  );
}
