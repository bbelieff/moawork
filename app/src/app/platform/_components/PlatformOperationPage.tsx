import { PlatformShell } from "@/components/platform/PlatformShell";
import { requirePlatformAccess } from "@/lib/platform/guard";
import {
  PLATFORM_OPERATION_CONTRACTS,
  type PlatformOperationSectionKey,
} from "@/lib/platform/operations/contracts";
import { loadPlatformOperationSnapshot } from "@/lib/platform/operations/server";

const COPY: Record<PlatformOperationSectionKey, { title: string; description: string }> = {
  billing: {
    title: "결제·매출",
    description: "확인된 집계 연결 상태와 허용 범위만 보여줘요.",
  },
  access: {
    title: "접근 기록",
    description: "개인 행동 원문 없이 감사 가능한 집계 계약만 확인해요.",
  },
  support: {
    title: "지원",
    description: "현재 계정에 승인된 읽기 전용 지원 범위만 확인해요.",
  },
  admins: {
    title: "어드민 관리",
    description: "현재 계정 자신의 운영 역할과 변경 금지 경계를 확인해요.",
  },
};

export async function PlatformOperationPage({
  section,
  pathname,
}: {
  section: PlatformOperationSectionKey;
  pathname: string;
}) {
  await requirePlatformAccess(pathname);
  const snapshot = await loadPlatformOperationSnapshot(section);
  const contract = PLATFORM_OPERATION_CONTRACTS[section];
  const copy = COPY[section];

  return (
    <PlatformShell
      pathname={pathname}
      title={copy.title}
      description={copy.description}
      userModeAction={{ mode: "user" }}
    >
      <section aria-labelledby="platform-operation-data-title">
        <h2 id="platform-operation-data-title">현재 확인 값</h2>
        {snapshot.kind === "unavailable" ? (
          <p>{snapshot.message}</p>
        ) : (
          <>
            <dl>
              {snapshot.values.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>
                    <strong>{item.value}</strong>
                    <p>{item.description}</p>
                  </dd>
                </div>
              ))}
            </dl>
            <p>확인 시각: {snapshot.observedAt}</p>
          </>
        )}
      </section>

      <section aria-labelledby="platform-operation-boundary-title">
        <h2 id="platform-operation-boundary-title">데이터와 권한 경계</h2>
        <ul>
          <li>읽기: {contract.currentRead.summary}</li>
          <li>쓰기: 제공하지 않아요. 변경은 별도 검수 계약이 필요해요.</li>
          <li>관리자 모드는 회사 데이터 접근 권한을 새로 만들지 않아요.</li>
          <li>감사에는 탭·집계 범위·요청 시각과 허용·거부 결과만 남겨야 해요.</li>
        </ul>
      </section>
    </PlatformShell>
  );
}
