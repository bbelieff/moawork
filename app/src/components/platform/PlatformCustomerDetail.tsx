"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { ResultBanner } from "@/lib/ui/ResultBanner";
import { type ResultNotice } from "@/lib/ui/result-notice";
import {
  CUSTOMER_INVITE_APPROVAL_NOTE,
  CUSTOMER_TASK_LIST_LIMIT,
  CUSTOMER_TEMPLATE_NO_RECORD,
  customerInviteJoinUrl,
  historyValueLabel,
  INVITE_STATE_LABEL,
  SETUP_STATUS_LABEL,
  TASK_KIND_LABEL,
  TASK_STATUS_LABEL,
  validateCustomerTaskInput,
  type CustomerDetail,
  type CustomerHistoryEntry,
  type CustomerTask,
  type CustomerTaskKind,
  type CustomerTaskStatus,
} from "@/lib/platform/customers/contracts";
import styles from "./platform.module.css";

type Tab = "overview" | "tasks" | "history";
const subscribeOrigin = () => () => {};
const browserOrigin = () => window.location.origin;
const serverOrigin = () => "";

function timestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시각 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return typeof body.message === "string" && body.message ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export function PlatformCustomerDetail({
  customer,
  tasks,
  history,
}: {
  customer: CustomerDetail;
  tasks: CustomerTask[];
  history: CustomerHistoryEntry[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [notice, setNotice] = useState<ResultNotice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  // 작업 입력도 실패하면 지우지 않는다.
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CustomerTaskKind>("setup");
  const [taskError, setTaskError] = useState<string | null>(null);
  const taskRequestId = useRef<string | null>(null);
  // 초대 주소 복사는 전달이 아니다. 복사만 하고, 안내 기록은 아래 버튼으로 따로 남긴다.
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const openTasks = tasks.filter((task) => task.status !== "done");
  const origin = useSyncExternalStore(subscribeOrigin, browserOrigin, serverOrigin);
  const invitePath = customerInviteJoinUrl(customer.slug);
  const inviteUrl = invitePath && origin ? new URL(invitePath, origin).href : invitePath;
  const taskTitleById = new Map(tasks.map((task) => [task.taskId, task.title]));

  async function copyInviteUrl(url: string): Promise<void> {
    setCopyState("idle");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      // 클립보드 실패는 선택 가능한 링크와 오류로 말한다. 전송됐다고 말하지 않는다.
      setCopyState("failed");
    }
  }

  async function patchAxis(body: { setupStatus?: string; inviteState?: string }, key: string, done: string, same: string): Promise<void> {
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch(`/api/platform/customers/${customer.orgId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setNotice({ ok: false, message: await readError(response, "처리하지 못했어요. 목록을 새로 확인한 뒤 다시 시도해 주세요.") });
        return;
      }
      const result = (await response.json()) as { changed?: boolean };
      setNotice({ ok: true, message: result.changed === false ? same : done });
      router.refresh();
    } catch {
      setNotice({ ok: false, message: "처리하지 못했어요. 목록을 새로 확인한 뒤 다시 시도해 주세요." });
    } finally {
      setBusy(null);
    }
  }

  async function submitTask(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const invalid = validateCustomerTaskInput({ title, kind });
    if (invalid) {
      setTaskError(invalid);
      return;
    }
    setBusy("task-create");
    if (!taskRequestId.current) taskRequestId.current = crypto.randomUUID();
    setTaskError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/platform/customers/${customer.orgId}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: taskRequestId.current, title: title.trim(), kind }),
      });
      if (!response.ok) {
        setTaskError(await readError(response, "작업을 저장하지 못했어요."));
        return;
      }
      setTitle("");
      taskRequestId.current = null;
      setTaskOpen(false);
      setNotice({ ok: true, message: "작업을 추가했어요." });
      router.refresh();
    } catch {
      setTaskError("작업을 저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  async function changeTaskStatus(task: CustomerTask, status: CustomerTaskStatus): Promise<void> {
    if (task.status === status) return;
    setBusy(task.taskId);
    setNotice(null);
    try {
      const response = await fetch(`/api/platform/customers/${customer.orgId}/tasks/${task.taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        setNotice({ ok: false, message: await readError(response, "작업 상태를 바꾸지 못했어요.") });
        router.refresh();
        return;
      }
      setNotice({ ok: true, message: `작업 상태를 ${TASK_STATUS_LABEL[task.status]} → ${TASK_STATUS_LABEL[status]}(으)로 바꿨어요.` });
      router.refresh();
    } catch {
      setNotice({ ok: false, message: "작업 상태를 바꾸지 못했어요." });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.organizationConsole}>
      <section className={styles.detailHead} aria-labelledby="customer-detail-title">
        <Link className={styles.backLink} href="/platform/organizations">‹ 고객사 목록</Link>
        <div className={styles.detailTitle}>
          <h2 id="customer-detail-title">{customer.name}</h2>
          <span className={`${styles.statusTag} ${customer.setupStatus === "active" ? styles.statusTagOk : styles.statusTagInfo}`}>
            {SETUP_STATUS_LABEL[customer.setupStatus]}
          </span>
          <span className={`${styles.statusTag} ${customer.inviteState === "active" ? styles.statusTagOk : customer.inviteState === "sent" ? styles.statusTagWarn : styles.statusTagNeutral}`}>
            {INVITE_STATE_LABEL[customer.inviteState]}
          </span>
        </div>
        <div className={styles.organizationActions}>
          {customer.canEnter && customer.slug ? (
            <Link className={styles.entryLink} href={`/w/${customer.slug}`}>회사로 이동</Link>
          ) : (
            <span className={styles.entryBlocked}>이 회사 멤버가 아니라 회사 화면으로 이동할 수 없어요</span>
          )}
          <button type="button" className={styles.rejectButton} onClick={() => { setTab("tasks"); setTaskOpen(true); }}>
            관리 작업 추가
          </button>
        </div>
      </section>

      {notice ? <ResultBanner notice={notice} okClassName={styles.organizationStatus} errorClassName={styles.organizationError} /> : null}

      <div className={styles.detailTabs} role="tablist" aria-label="고객사 상세">
        {([
          ["overview", "개요"],
          ["tasks", `세팅·지원 (${openTasks.length}건)`],
          ["history", `관리 이력 (${history.length}건)`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className={styles.detailGrid}>
          <section className={styles.approvalQueue} aria-label="기본 정보">
            <h3>기본 정보</h3>
            <dl className={styles.detailFacts}>
              <div><dt>업종</dt><dd>{customer.industry}</dd></div>
              <div><dt>대표 참여</dt><dd>{customer.inviteState === "active" ? `참여 완료 (구성원 ${customer.memberCount}명)` : `${INVITE_STATE_LABEL[customer.inviteState]} · 대표 확인 필요`}</dd></div>
              <div><dt>구성원 수</dt><dd>{customer.memberCount}명</dd></div>
              <div>
                <dt>적용 기본형</dt>
                <dd>{customer.template.key ?? CUSTOMER_TEMPLATE_NO_RECORD}</dd>
              </div>
              <div><dt>최근 관리일</dt><dd>{timestamp(customer.updatedAt)}</dd></div>
            </dl>
            {customer.template.key ? null : (
              <p className={styles.formNote}>기본형 적용은 회사 화면에서 진행해요. 기록이 없어 {CUSTOMER_TEMPLATE_NO_RECORD}으로 말해요.</p>
            )}
          </section>
          <section className={styles.approvalQueue} aria-label="세팅 체크리스트">
            <h3>세팅 체크리스트</h3>
            <ul className={styles.checkList}>
              <li><span className={`${styles.checkDot} ${styles.checkDone}`}>완료</span><span>회사 등록</span></li>
              <li>
                <span className={`${styles.checkDot} ${customer.inviteState !== "pending" ? styles.checkDone : ""}`}>
                  {customer.inviteState !== "pending" ? "완료" : "대기"}
                </span>
                <span>대표 초대 발송</span>
              </li>
              <li>
                <span className={`${styles.checkDot} ${customer.inviteState === "active" ? styles.checkDone : ""}`}>
                  {customer.inviteState === "active" ? "완료" : "대기"}
                </span>
                <span>대표 수락</span>
              </li>
              <li>
                <span className={styles.checkDot}>대기</span>
                <span>기본형 적용 — 회사 화면에서 진행</span>
              </li>
              <li>
                <span className={`${styles.checkDot} ${customer.setupStatus === "active" ? styles.checkDone : ""}`}>
                  {customer.setupStatus === "active" ? "완료" : "대기"}
                </span>
                <span>세팅 완료</span>
              </li>
            </ul>
            <div className={styles.organizationActions}>
              {customer.setupStatus === "active" ? (
                <button
                  type="button"
                  className={styles.rejectButton}
                  disabled={busy !== null}
                  onClick={() => patchAxis({ setupStatus: "setting_up" }, "setup", "세팅을 다시 열었어요.", "이미 세팅 중이에요.")}
                >
                  세팅 다시 열기
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => patchAxis({ setupStatus: "active" }, "setup", "세팅을 완료 처리했어요.", "이미 이용 중이에요.")}
                >
                  {busy === "setup" ? "확인 중…" : "세팅 완료로 표시"}
                </button>
              )}
            </div>
          </section>
          <section className={styles.approvalQueue} aria-label="대표 초대">
            <h3>대표 초대</h3>
            {customer.inviteState === "active" ? (
              <p>대표 참여 완료 · 구성원 {customer.memberCount}명</p>
            ) : !customer.canManage ? (
              <p className={styles.formNote}>회사 대표만 초대를 관리할 수 있습니다.</p>
            ) : inviteUrl ? (
              <>
                <p>{customer.inviteState === "sent" ? "초대 안내함 · 대표 확인 필요" : "초대 전"}</p>
                <p className={styles.formNote}>{CUSTOMER_INVITE_APPROVAL_NOTE}.</p>
                <div className={styles.formRow}>
                  <div className={styles.formField}>
                    <label htmlFor="customer-invite-url">초대 주소 (승인 기반 합류)</label>
                    <input id="customer-invite-url" type="text" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
                  </div>
                </div>
                <div className={styles.organizationActions}>
                  <button type="button" disabled={busy !== null} onClick={() => void copyInviteUrl(inviteUrl)}>
                    초대 주소 복사
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => patchAxis({ inviteState: "sent" }, "invite", "초대 안내함으로 기록했어요.", "이미 초대 안내함으로 기록돼 있어요.")}
                  >
                    {busy === "invite" ? "확인 중…" : "초대 안내함으로 기록"}
                  </button>
                </div>
                {copyState === "copied" ? <p className={styles.formNote} role="status">초대 주소를 복사했습니다.</p> : null}
                {copyState === "failed" ? <p className={styles.formError} role="alert">복사하지 못했어요. 위 주소를 직접 선택해 복사해 주세요.</p> : null}
              </>
            ) : (
              <p className={styles.formNote}>회사 주소가 없어 초대 주소를 만들 수 없어요. 주소를 먼저 확인해 주세요.</p>
            )}
            {customer.canEnter ? null : (
              <p className={styles.formNote}>회사 화면에 들어가려면 해당 회사의 접근 권한이 필요합니다.</p>
            )}
          </section>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <section className={styles.approvalQueue} aria-label="세팅·지원 작업">
          <header>
            <div>
              <h3>작업 {tasks.length}건 (미처리 {openTasks.length}건)</h3>
              {tasks.length >= CUSTOMER_TASK_LIST_LIMIT ? (
                <p className={styles.formNote}>최대 {CUSTOMER_TASK_LIST_LIMIT}건까지 보여줘요. 전체가 아닐 수 있어요.</p>
              ) : null}
            </div>
            <button type="button" onClick={() => setTaskOpen((open) => !open)}>＋ 작업 추가</button>
          </header>
          {taskOpen ? (
            <form className={styles.registryForm} aria-label="관리 작업 추가" onSubmit={submitTask}>
              {taskError ? <p className={styles.formError} role="alert">{taskError}</p> : null}
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label htmlFor="customer-task-title">작업 내용 (필수)</label>
                  <input
                    id="customer-task-title"
                    type="text"
                    autoComplete="off"
                    maxLength={120}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div className={styles.formField}>
                  <label htmlFor="customer-task-kind">구분</label>
                  <select id="customer-task-kind" value={kind} onChange={(event) => setKind(event.target.value as CustomerTaskKind)}>
                    <option value="setup">초기 세팅</option>
                    <option value="support">지속 지원</option>
                  </select>
                </div>
              </div>
              <div className={styles.organizationActions}>
                <button type="submit" disabled={busy !== null}>{busy === "task-create" ? "저장 중…" : "저장"}</button>
                <button type="button" className={styles.rejectButton} disabled={busy !== null} onClick={() => setTaskOpen(false)}>취소</button>
              </div>
            </form>
          ) : null}
          {tasks.length === 0 ? (
            <div className={styles.organizationEmpty}>
              <strong>아직 작업이 없어요</strong>
              <p>초대 안내·기본형 협의 같은 다음 할 일을 추가해 보세요.</p>
            </div>
          ) : (
            <ul className={styles.taskRows}>
              {tasks.map((task) => (
                <li key={task.taskId}>
                  <span className={styles.taskKind}>{TASK_KIND_LABEL[task.kind]}</span>
                  <span className={styles.taskTitle}>{task.title}</span>
                  <label htmlFor={`task-status-${task.taskId}`}>상태</label>
                  <select
                    id={`task-status-${task.taskId}`}
                    value={task.status}
                    disabled={busy !== null}
                    onChange={(event) => changeTaskStatus(task, event.target.value as CustomerTaskStatus)}
                  >
                    <option value="todo">할 일</option>
                    <option value="in_progress">진행 중</option>
                    <option value="done">완료</option>
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "history" ? (
        <section className={styles.approvalQueue} aria-label="관리 이력">
          <h3>관리 이력 {history.length}건</h3>
          {history.length === 0 ? (
            <p className={styles.formNote}>아직 기록된 관리 이력이 없어요. 상태 변경·작업 추가가 여기에 남아요.</p>
          ) : (
            <ul className={styles.historyRows}>
              {history.map((entry, index) => (
                <li key={`${entry.createdAt}-${index}`}>
                  <div><strong>{entry.label}</strong> · <span className={styles.historyChange}>{historyValueLabel(entry.before)} → {historyValueLabel(entry.after)}</span></div>
                  <div className={styles.historyMeta}>{timestamp(entry.createdAt)}</div>
                  {entry.taskId && taskTitleById.get(entry.taskId) ? (
                    <div className={styles.formNote}>관련 작업: {taskTitleById.get(entry.taskId)}</div>
                  ) : null}
                  {entry.memo ? <div className={styles.formNote}>{entry.memo}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
