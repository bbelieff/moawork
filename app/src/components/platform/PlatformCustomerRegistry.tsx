"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ResultBanner } from "@/lib/ui/ResultBanner";
import { type ResultNotice } from "@/lib/ui/result-notice";
import { validateWorkspaceSlug } from "@/lib/workspace-entry/contracts";
import {
  CUSTOMER_INDUSTRY_FIXED,
  INVITE_STATE_LABEL,
  SETUP_STATUS_LABEL,
  type CustomerListFilter,
  type CustomerListQuery,
  type CustomerSummary,
} from "@/lib/platform/customers/contracts";
import styles from "./platform.module.css";

export const CUSTOMER_FILTERS: { key: CustomerListFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "setting_up", label: "세팅 중" },
  { key: "active", label: "이용 중" },
];

function updatedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function queryHref(query: CustomerListQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.status !== "all") params.set("status", query.status);
  const text = params.toString();
  return text ? `/platform/organizations?${text}` : "/platform/organizations";
}

export function PlatformCustomerRegistry({
  customers,
  query,
  problem,
}: {
  customers: CustomerSummary[];
  query: CustomerListQuery;
  problem: null | "denied" | "unavailable";
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query.search);
  const [formOpen, setFormOpen] = useState(false);
  // 회사명·주소는 실패해도 그대로 둔다 — 다시 치게 하지 않는다.
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ResultNotice | null>(null);
  // 폼을 열 때마다 새 멱등 키. 같은 내용 재전송은 같은 요청으로 처리된다.
  const requestId = useRef<string | null>(null);

  function openForm(): void {
    requestId.current = crypto.randomUUID();
    setFormError(null);
    setFormOpen(true);
  }

  async function submitNew(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const displayName = name.trim();
    if (displayName.length < 1 || displayName.length > 80) {
      setFormError("회사 이름을 1~80자로 입력해 주세요.");
      return;
    }
    const slugError = validateWorkspaceSlug(slug);
    if (slugError) {
      setFormError(slugError);
      return;
    }
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const created = await fetch("/api/workspace-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "create", displayName, slug: slug.trim(), requestId: requestId.current }),
      });
      const result = (await created.json()) as { ok: boolean; state?: string; message?: string };
      if (!result.ok) {
        // 입력값은 그대로 둔다. 고쳐서 같은 멱등 키로 다시 보내면 된다.
        setFormError(result.message ?? "등록하지 못했어요. 입력값을 확인해 주세요.");
        return;
      }
      // 저장을 «주장» 하지 않는다 — 목록에서 다시 읽어 확인된 회사로만 이동한다.
      const reread = await fetch(`/api/platform/customers?q=${encodeURIComponent(slug.trim())}`, { cache: "no-store" });
      const listed = (await reread.json()) as { ok: boolean; customers?: { orgId: string; slug: string | null }[] };
      const match = reread.ok && listed.ok
        ? (listed.customers ?? []).find((row) => row.slug === slug.trim())
        : undefined;
      if (!match) {
        setFormError("등록은 됐지만 목록에서 확인되지 않아요. 새로고침 후 다시 확인해 주세요.");
        router.refresh();
        return;
      }
      router.push(`/platform/organizations/${match.orgId}`);
      router.refresh();
    } catch {
      setFormError("등록하지 못했어요. 목록을 새로 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.organizationConsole}>
      <section className={styles.onboardingSummary} aria-labelledby="customer-registry-title">
        <div>
          <h2 id="customer-registry-title">고객사 목록</h2>
        </div>
        <div className={styles.registryActions}>
          <button type="button" className={styles.primaryButton} onClick={openForm}>새 고객사</button>
          <button type="button" className={styles.ghostButton} onClick={() => router.refresh()}>새로고침</button>
        </div>
      </section>

      {notice ? <ResultBanner notice={notice} okClassName={styles.organizationStatus} errorClassName={styles.organizationError} /> : null}

      {formOpen ? (
        <form className={styles.registryForm} aria-label="새 고객사 등록" onSubmit={submitNew}>
          <h3>새 고객사 등록</h3>
          {formError ? <p className={styles.formError} role="alert">{formError}</p> : null}
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label htmlFor="customer-new-name">회사명 (필수)</label>
              <input
                id="customer-new-name"
                type="text"
                autoComplete="off"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className={styles.formField}>
              <label htmlFor="customer-new-slug">회사 주소 (필수, 영문·숫자·하이픈)</label>
              <input
                id="customer-new-slug"
                type="text"
                autoComplete="off"
                maxLength={40}
                placeholder="acme-consulting"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            </div>
            <div className={styles.formField}>
              <span aria-hidden="true">업종</span>
              <span>{CUSTOMER_INDUSTRY_FIXED} (고정)</span>
            </div>
          </div>
          <div className={styles.organizationActions}>
            <button type="submit" disabled={busy}>{busy ? "등록 중…" : "고객사 만들기"}</button>
            <button type="button" className={styles.rejectButton} disabled={busy} onClick={() => setFormOpen(false)}>취소</button>
          </div>
          <p className={styles.formNote}>등록 직후 상태: 초대 전 · 세팅 중. 목록에서 확인된 뒤 상세 화면으로 이동해요.</p>
        </form>
      ) : null}

      <section className={styles.approvalQueue} aria-labelledby="customer-list-title">
        <header>
          <div>
            <p className={styles.sectionLabel}>등록 고객</p>
            <h2 id="customer-list-title">고객사 {problem ? "확인 필요" : `${customers.length}곳`}</h2>
          </div>
          <form
            className={styles.registrySearch}
            role="search"
            aria-label="고객사 검색"
            onSubmit={(event) => {
              event.preventDefault();
              router.push(queryHref({ search: search.trim().slice(0, 80), status: query.status }));
            }}
          >
            <label htmlFor="customer-search">회사 검색</label>
            <input
              id="customer-search"
              type="text"
              autoComplete="off"
              placeholder="회사명 입력"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </form>
        </header>
        <div className={styles.registryFilters} role="group" aria-label="도입 상태 필터">
          {CUSTOMER_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              aria-pressed={query.status === filter.key}
              className={query.status === filter.key ? styles.filterActive : undefined}
              onClick={() => router.push(queryHref({ search: query.search, status: filter.key }))}
            >
              {filter.label}
            </button>
          ))}
          <span className={styles.queueCount}>승인 대기는 아래 요청 대기열에서 처리해요</span>
        </div>
        {problem ? (
          <div className={styles.organizationEmpty}>
            <strong>고객 목록을 불러오지 못했어요</strong>
            <p>{problem === "denied" ? "서비스 관리자만 볼 수 있어요." : "페이지를 새로고침한 뒤 다시 시도해 주세요."}</p>
          </div>
        ) : customers.length === 0 ? (
          <div className={styles.organizationEmpty}>
            <strong>조건에 맞는 고객사가 없어요</strong>
            <p>새 고객사로 첫 회사를 등록해 보세요.</p>
          </div>
        ) : (
          <ul className={styles.customerRows}>
            {customers.map((customer) => (
              <li key={customer.orgId}>
                <button
                  type="button"
                  className={styles.customerName}
                  onClick={() => router.push(`/platform/organizations/${customer.orgId}`)}
                >
                  {customer.name}
                </button>
                <span className={styles.customerMeta}>{customer.slug ? `/w/${customer.slug}` : "주소 확인 필요"}</span>
                <span className={`${styles.statusTag} ${customer.setupStatus === "active" ? styles.statusTagOk : styles.statusTagInfo}`}>
                  {SETUP_STATUS_LABEL[customer.setupStatus]}
                </span>
                <span className={`${styles.statusTag} ${customer.inviteState === "active" ? styles.statusTagOk : customer.inviteState === "sent" ? styles.statusTagWarn : styles.statusTagNeutral}`}>
                  {INVITE_STATE_LABEL[customer.inviteState]}
                </span>
                <span className={styles.customerMeta}>미처리 {customer.openTaskCount}건</span>
                <span className={styles.customerMeta}>{updatedAt(customer.updatedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
