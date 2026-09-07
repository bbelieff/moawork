"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OwnerJoinRequest, PlatformCreateRequest } from "@/lib/workspace-entry/server";
import { submitWorkspaceRequest } from "@/lib/workspace-entry/contracts";
import { type ResultNotice } from "@/lib/ui/result-notice";
import { ResultBanner } from "@/lib/ui/ResultBanner";
import styles from "./workspace-entry.module.css";

type Props =
  | { mode: "platform"; requests: PlatformCreateRequest[] }
  | { mode: "owner"; requests: OwnerJoinRequest[]; workspaceName: string };

export function ApprovalQueue(props: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ResultNotice | null>(null);

  async function decide(requestId: string, approve: boolean) {
    setBusyId(requestId);
    setNotice(null);
    try {
      const result = await submitWorkspaceRequest({
        kind: props.mode === "platform" ? "resolve_create" : "resolve_join",
        requestId,
        approve,
      });
      // 판정을 «표현» 까지 데려간다 — ok 를 여기서 버리면 실패가 「처리됐다」로 읽힌다(BBE-208).
      setNotice({ ok: result.ok, message: result.message });
      if (result.ok) router.refresh();
    } catch {
      setNotice({ ok: false, message: "처리하지 못했어요. 목록을 새로 확인한 뒤 다시 시도해 주세요." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.queue}>
      <div className={styles.guideHead}>
        <span className={styles.guideAvatar} aria-hidden="true">M</span>
        <div>
          <strong>{props.mode === "platform" ? "회사 만들기 검토" : `${props.workspaceName} 합류 검토`}</strong>
          <small>{props.mode === "platform" ? "플랫폼 운영 영역이에요. 고객 회사 내부 권한은 생기지 않아요." : "이 회사의 보호된 대표만 결정할 수 있어요."}</small>
        </div>
      </div>
      {notice ? <ResultBanner notice={notice} okClassName={styles.status} errorClassName={styles.error} /> : null}
      {props.requests.length === 0 ? (
        <div className={styles.bubble}><strong>지금 검토할 요청이 없어요.</strong><small>새 요청이 오면 이 목록에서 확인할 수 있어요.</small></div>
      ) : (
        <ul className={styles.queueList}>
          {props.requests.map((request, index) => (
            <li key={request.requestId} className={styles.summaryStep}>
              <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
              <div>
                <strong>{"desiredName" in request ? request.desiredName : `합류 요청 ${index + 1}`}</strong>
                <small>{"desiredSlug" in request ? `/w/${request.desiredSlug} · 최종 생성 전` : "승인하면 구성원·최소 범위로 시작해요."}</small>
              </div>
              <div className={styles.inlineActions}>
                <button type="button" className={styles.quietButton} disabled={busyId !== null} onClick={() => decide(request.requestId, false)}>승인하지 않기</button>
                <button type="button" disabled={busyId !== null} onClick={() => decide(request.requestId, true)}>{busyId === request.requestId ? "확인 중…" : props.mode === "platform" ? "회사 만들기 승인" : "합류 승인"}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.safety}>승인은 서버가 현재 권한과 요청 상태를 다시 확인한 뒤 한 번만 반영해요.</p>
    </div>
  );
}
