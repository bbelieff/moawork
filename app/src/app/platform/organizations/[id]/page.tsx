import Link from "next/link";
import { PlatformCustomerDetail } from "@/components/platform/PlatformCustomerDetail";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { requirePlatformAccess } from "@/lib/platform/guard";
import { isCustomerId } from "@/lib/platform/customers/contracts";
import { platformCustomerClient, readPlatformCustomerDetail } from "@/lib/platform/customers/server";
import styles from "@/components/platform/platform.module.css";

const PATHNAME = "/platform/organizations";

function MissingPanel({ message }: { message: string }) {
  return (
    <section className={styles.organizationUnavailable} aria-labelledby="customer-missing-title">
      <h2 id="customer-missing-title">고객사를 열 수 없어요</h2>
      <p>{message}</p>
      <p><Link href="/platform/organizations">‹ 고객사 목록으로 돌아가기</Link></p>
    </section>
  );
}

export default async function PlatformCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePlatformAccess(`${PATHNAME}/${id}`);

  if (!isCustomerId(id)) {
    return (
      <PlatformShell pathname={PATHNAME} title="고객사 상세" description="등록 고객의 도입·지원 상태를 확인해요." userModeAction={{ mode: "user" }}>
        <MissingPanel message="주소가 올바르지 않아요. 목록에서 다시 선택해 주세요." />
      </PlatformShell>
    );
  }

  let detail = null;
  let problem: null | "denied" | "not-found" | "invalid" | "unavailable" = null;
  try {
    const result = await readPlatformCustomerDetail(await platformCustomerClient(), id);
    if (result.ok) {
      detail = result;
    } else {
      problem = result.reason;
    }
  } catch {
    problem = "unavailable";
  }

  return (
    <PlatformShell
      pathname={PATHNAME}
      title={detail ? detail.customer.name : "고객사 상세"}
      description="등록 고객의 도입·지원 상태를 확인해요. 업무 내용은 보이지 않아요."
      userModeAction={{ mode: "user" }}
    >
      {detail ? (
        <PlatformCustomerDetail customer={detail.customer} tasks={detail.tasks} history={detail.history} />
      ) : (
        <MissingPanel
          message={
            problem === "not-found"
              ? "없는 고객사이거나 삭제됐어요. 목록을 새로 확인해 주세요."
              : problem === "denied"
                ? "서비스 관리자만 볼 수 있어요."
                : "지금 확인할 수 없어요. 목록을 새로 확인한 뒤 다시 시도해 주세요."
          }
        />
      )}
    </PlatformShell>
  );
}
