"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { noticeLive, noticeRole, type ResultNotice } from "@/lib/ui/result-notice";
import styles from "./platform.module.css";
import type { PlatformAggregateState } from "@/lib/platform/contracts";
import type { PlatformCreateRequest } from "@/lib/workspace-entry/server";
import { submitWorkspaceRequest } from "@/lib/workspace-entry/contracts";

type Props = {
  requests: PlatformCreateRequest[] | null;
  aggregate: PlatformAggregateState;
};

export function connectedWorkspaceCount(aggregate: PlatformAggregateState): string | null {
  if (aggregate.kind !== "ready") return null;
  return aggregate.values.find((value) => value.label === "연결된 워크스페이스")?.value ?? null;
}

function requestedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "요청 시각 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

export function PlatformOrganizationsPanel({ requests, aggregate }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ResultNotice | null>(null);
  const connectedCount = connectedWorkspaceCount(aggregate);

  async function decide(requestId: string, approve: boolean) {
    setBusyId(requestId);
    setNotice(null);
    try {
      const result = await submitWorkspaceRequest({
        kind: "resolve_create",
        requestId,
        approve,
      });
      // 판정을 «표현» 까지 데려간다 — 조직 처리 실패가 「처리됐다」로 읽히면 안 된다(BBE-208).
      setNotice({ ok: result.ok, message: result.message });
      if (result.ok) router.refresh();
    } catch {
      setNotice({ ok: false, message: "처리하지 못했어요. 요청 목록을 새로 확인한 뒤 다시 시도해 주세요." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.organizationConsole}>
      <section className={styles.onboardingSummary} aria-labelledby="organization-onboarding-title">
        <div>
          <p className={styles.sectionLabel}>첫 진입 관리</p>
          <h2 id="organization-onboarding-title">회사 요청을 승인하면 바로 시작할 수 있어요</h2>
          <p>승인하면 회사가 만들어지고 요청자가 대표 권한으로 연결돼요. 고객 업무나 개인정보는 이 화면에서 열지 않아요.</p>
        </div>
        <dl className={styles.onboardingMetrics}>
          <div>
            <dt>승인 대기</dt>
            <dd>{requests === null ? "확인 필요" : `${requests.length}건`}</dd>
          </div>
          <div>
            <dt>연결된 회사</dt>
            <dd>{connectedCount ?? "집계 확인 필요"}</dd>
          </div>
        </dl>
      </section>

      <ol className={styles.onboardingSteps} aria-label="고객사 첫 진입 순서">
        <li><span>1</span><div><strong>사용자가 요청</strong><small>로그인 후 회사 이름과 주소를 입력해요.</small></div></li>
        <li><span>2</span><div><strong>관리자가 승인</strong><small>아래 요청을 확인하고 한 번만 승인해요.</small></div></li>
        <li><span>3</span><div><strong>회사 업무 시작</strong><small>요청자가 대표로 연결되어 사용자 모드로 들어가요.</small></div></li>
      </ol>

      {notice ? <p className={notice.ok ? styles.organizationStatus : styles.organizationError} role={noticeRole(notice.ok)} aria-live={noticeLive(notice.ok)}>{notice.message}</p> : null}

      {requests === null ? (
        <section className={styles.organizationUnavailable} aria-labelledby="organization-unavailable-title">
          <h2 id="organization-unavailable-title">승인 요청을 불러오지 못했어요</h2>
          <p>관리자 권한과 요청 연결 상태를 확인해 주세요. 권한을 추정해서 승인 버튼을 보여주지 않아요.</p>
        </section>
      ) : (
        <section className={styles.approvalQueue} aria-labelledby="organization-approval-title">
          <header>
            <div>
              <p className={styles.sectionLabel}>승인 대기열</p>
              <h2 id="organization-approval-title">회사 만들기 요청</h2>
            </div>
            <span className={styles.queueCount}>{requests.length}건</span>
          </header>
          {requests.length === 0 ? (
            <div className={styles.organizationEmpty}>
              <strong>지금 승인할 요청이 없어요</strong>
              <p>새 요청이 들어오면 회사 이름과 주소가 여기에 표시돼요.</p>
            </div>
          ) : (
            <ul className={styles.organizationRequests}>
              {requests.map((request) => (
                <li key={request.requestId}>
                  <div className={styles.organizationRequestMark} aria-hidden="true">회</div>
                  <div className={styles.organizationRequestCopy}>
                    <strong>{request.desiredName}</strong>
                    <span>/w/{request.desiredSlug}</span>
                    <small>{requestedAt(request.createdAt)}</small>
                  </div>
                  <div className={styles.organizationActions}>
                    <button
                      type="button"
                      className={styles.rejectButton}
                      disabled={busyId !== null}
                      onClick={() => decide(request.requestId, false)}
                    >
                      승인하지 않기
                    </button>
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => decide(request.requestId, true)}
                    >
                      {busyId === request.requestId ? "확인 중…" : "승인하고 회사 열기"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.approvalSafety}>승인할 때 서버가 관리자 권한과 요청 상태를 다시 확인하고, 회사 생성과 대표 연결을 한 번에 처리해요.</p>
        </section>
      )}
    </div>
  );
}
