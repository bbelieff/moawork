"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PlatformCustomerRegistry } from "@/components/platform/PlatformCustomerRegistry";
import { PlatformCustomerDetail } from "@/components/platform/PlatformCustomerDetail";
import type {
  CustomerDetail,
  CustomerHistoryEntry,
  CustomerSummary,
  CustomerTask,
} from "@/lib/platform/customers/contracts";

const FAKE_ORG_A = "11111111-0000-4000-8000-0000000000a1";
const FAKE_ORG_B = "11111111-0000-4000-8000-0000000000b2";
const FAKE_TASK_1 = "11111111-0000-4000-8000-000000000071";

const FAKE_SUMMARIES: CustomerSummary[] = [
  {
    orgId: FAKE_ORG_A,
    name: "가상고객사 다람쥐",
    slug: "visual-acorn",
    orgStatus: "active",
    industry: "미설정",
    setupStatus: "setting_up",
    inviteState: "pending",
    memberCount: 1,
    openTaskCount: 1,
    updatedAt: "2026-09-17T00:00:00Z",
  },
  {
    orgId: FAKE_ORG_B,
    name: "가상고객사 밤나무",
    slug: "visual-chestnut",
    orgStatus: "active",
    industry: "경영컨설팅",
    setupStatus: "active",
    inviteState: "active",
    memberCount: 3,
    openTaskCount: 0,
    updatedAt: "2026-09-17T00:00:00Z",
  },
];

const FAKE_DETAIL: CustomerDetail = {
  ...FAKE_SUMMARIES[0],
  hasRep: false,
  canEnter: false,
  canManage: true,
  template: { key: null, appliedAt: null },
};

const FAKE_TASKS: CustomerTask[] = [
  {
    taskId: FAKE_TASK_1,
    title: "가상 작업 예시",
    kind: "setup",
    status: "todo",
    createdAt: "2026-09-17T00:00:00Z",
    updatedAt: "2026-09-17T00:00:00Z",
  },
];

const FAKE_HISTORY: CustomerHistoryEntry[] = [
  {
    label: "관리 작업 추가",
    before: "없음",
    after: "todo",
    memo: "초기 세팅 작업 등록",
    taskId: FAKE_TASK_1,
    createdAt: "2026-09-17T00:00:00Z",
  },
];

function localResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * 가상 보기용 fetch 가로채기. 플랫폼·등록 API 호출만 로컬 가짜 응답으로
 * 답하고, 그 외 요청은 원래 fetch에 그대로 넘긴다. 어떤 쓰기도
 * 운영 데이터에 닿지 않는다.
 */
function installLocalFetch(): () => void {
  const original = window.fetch.bind(window);
  const stubbed: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (url.startsWith("/api/platform/customers") || url.startsWith("/api/workspace-requests")) {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.startsWith("/api/platform/customers?")) {
        return localResponse({ ok: true, customers: FAKE_SUMMARIES });
      }
      if (method === "PATCH") return localResponse({ ok: true, changed: true });
      if (method === "POST") {
        const taskId = FAKE_TASK_1;
        return localResponse({ ok: true, created: true, taskId }, 201);
      }
      return localResponse({ ok: false, message: "가상 보기에서는 읽지 않아요." }, 503);
    }
    return original(input, init);
  }) as typeof fetch;
  window.fetch = stubbed;
  return () => {
    window.fetch = original;
  };
}

export function PlatformFixtureClient({ view }: { view: "list" | "detail" }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const restore = installLocalFetch();
    // 가상 보기의 로컬 fetch 가로채기를 켠 뒤 첫 렌더로 바꾼다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fixture-only mount flip, no data flow
    setReady(true);
    return restore;
  }, []);
  if (!ready) return <p>가상 보기를 준비하고 있어요.</p>;
  return (
    <div>
      <p>
        가상 보기 — 가짜 이름·가짜 주소만 써요. 버튼을 눌러도 저장은 실제로
        나가지 않아요. <button type="button" onClick={() => router.push(view === "list" ? "/login/platform-fixture?view=detail" : "/login/platform-fixture?view=list")}>
          {view === "list" ? "상세 보기로" : "목록으로"}
        </button>
      </p>
      {view === "list" ? (
        <PlatformCustomerRegistry
          customers={FAKE_SUMMARIES}
          query={{ search: "", status: "all" }}
          problem={null}
        />
      ) : (
        <PlatformCustomerDetail customer={FAKE_DETAIL} tasks={FAKE_TASKS} history={FAKE_HISTORY} />
      )}
    </div>
  );
}
