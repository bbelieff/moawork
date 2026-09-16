import { describe, expect, it } from "vitest";
import {
  customerInviteJoinUrl,
  historyValueLabel,
  isCustomerId,
  parseCustomerDetail,
  parseCustomerHistory,
  parseCustomerList,
  parseCustomerTaskList,
  parseCustomerListQuery,
  parseInviteJoinSlug,
  validateCustomerTaskInput,
} from "./contracts";
import {
  customerFailureFromRpcError,
  readPlatformCustomerDetail,
  readPlatformCustomerList,
  writeCustomerInvite,
  writeCustomerSetup,
  writeCustomerTask,
  writeCustomerTaskStatus,
  type CustomerRpcClient,
} from "./server";

const summary = {
  org_id: "00000000-0000-4000-8000-0000000000a1",
  name: "알파 회사",
  slug: "alpha",
  org_status: "active",
  industry: "경영컨설팅",
  setup_status: "setting_up",
  invite_state: "pending",
  member_count: 1,
  open_task_count: 2,
  updated_at: "2026-09-17T00:00:00Z",
};

const detail = {
  ...summary,
  has_rep: false,
  can_enter: true,
  can_manage: true,
  template: { key: null, applied_at: null },
};

function stubClient(handlers: Record<string, (params?: Record<string, unknown>) => unknown>): CustomerRpcClient {
  return {
    rpc: async (name, params) => {
      const handler = handlers[name];
      if (!handler) return { data: null, error: { code: "42883" } };
      try {
        return { data: handler(params), error: null };
      } catch (error) {
        return { data: null, error: error as { code?: string | null } };
      }
    },
  };
}

const rpcError = (code: string, message = "") => {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  throw error;
};

describe("customers contracts", () => {
  it("parses the narrow registry shape and rejects malformed rows", () => {
    expect(parseCustomerList([summary])).toHaveLength(1);
    expect(parseCustomerList([])).toEqual([]);
    expect(parseCustomerList(null)).toBeNull();
    expect(parseCustomerList([{ ...summary, setup_status: "bogus" }])).toBeNull();
    expect(parseCustomerList([{ ...summary, member_count: -1 }])).toBeNull();
    expect(parseCustomerList([{ ...summary, name: "" }])).toBeNull();
  });

  it("parses detail only with the entry grant and a consistent template", () => {
    expect(parseCustomerDetail(detail)?.canEnter).toBe(true);
    expect(parseCustomerDetail(detail)?.canManage).toBe(true);
    // 구 응답에 can_manage이 없어도 닫힌 쪽으로 파싱된다.
    const legacy = { ...detail } as Record<string, unknown>;
    delete legacy.can_manage;
    expect(parseCustomerDetail(legacy)?.canManage).toBe(false);
    expect(parseCustomerDetail({ ...summary })).toBeNull();
    expect(parseCustomerDetail({ ...detail, template: { key: null, applied_at: "2026-09-17" } })).toBeNull();
    expect(parseCustomerDetail({
      ...detail,
      template: { key: "consulting-v1", applied_at: "2026-09-17T00:00:00Z" },
    })).toMatchObject({ template: { key: "consulting-v1" } });
  });

  it("parses tasks and history or fails as a bundle", () => {
    const task = {
      task_id: "00000000-0000-4000-8000-000000000071",
      title: "대표 초대 안내",
      kind: "setup",
      status: "todo",
      created_at: "2026-09-17T00:00:00Z",
      updated_at: "2026-09-17T00:00:00Z",
    };
    expect(parseCustomerTaskList([task])).toHaveLength(1);
    expect(parseCustomerTaskList([{ ...task, kind: "bogus" }])).toBeNull();
    const entry = { label: "세팅 완료", before: "setting_up", after: "active", memo: "", task_id: null, created_at: "2026-09-17T00:00:00Z" };
    expect(parseCustomerHistory([entry])).toHaveLength(1);
    expect(parseCustomerHistory([{ ...entry, memo: 3 }])).toBeNull();
    // task_id가 있으면 UUID 모양만 받고, 깨진 값은 묶음 전체를 버린다.
    const taskId = "00000000-0000-4000-8000-000000000071";
    expect(parseCustomerHistory([{ ...entry, task_id: taskId }])?.[0].taskId).toBe(taskId);
    expect(parseCustomerHistory([{ ...entry, task_id: "not-a-uuid" }])).toBeNull();
    // task_id 키가 없는 구 응답도 null 참조로 읽힌다.
    const legacyEntry = { ...entry } as Record<string, unknown>;
    delete legacyEntry.task_id;
    expect(parseCustomerHistory([legacyEntry])?.[0].taskId).toBeNull();
  });

  it("renders history enums in Korean and validates the safe invite address", () => {
    expect(historyValueLabel("setting_up")).toBe("세팅 중");
    expect(historyValueLabel("todo")).toBe("할 일");
    expect(historyValueLabel("in_progress")).toBe("진행 중");
    expect(historyValueLabel("sent")).toBe("초대 안내함");
    expect(historyValueLabel("없음")).toBe("없음");
    // 원문 enum이 화면에 그대로 나가지 않는다.
    expect(historyValueLabel("todo")).not.toBe("todo");
    expect(parseInviteJoinSlug("Alpha_Team 01")).toBe("alpha-team-01");
    expect(parseInviteJoinSlug("platform")).toBe("platform");
    expect(parseInviteJoinSlug("ab")).toBeNull();
    // 외부 URL을 넣어도 외부로 나가지 않고 내부 join 주소의 slug로만 삭감된다.
    expect(customerInviteJoinUrl("https://evil.example/x")).toBe("/workspace-entry?mode=new&join=httpsevilexamplex");
    expect(customerInviteJoinUrl("alpha")).toBe("/workspace-entry?mode=new&join=alpha");
    expect(customerInviteJoinUrl(null)).toBeNull();
    expect(customerInviteJoinUrl("ab")).toBeNull();
  });

  it("reads the list query narrowly and validates customer ids", () => {
    expect(parseCustomerListQuery({ q: " 알파 ", status: "active" })).toEqual({ search: "알파", status: "active" });
    expect(parseCustomerListQuery({ status: "bogus" })).toEqual({ search: "", status: "all" });
    expect(parseCustomerListQuery(null)).toEqual({ search: "", status: "all" });
    expect(isCustomerId("00000000-0000-4000-8000-0000000000a1")).toBe(true);
    expect(isCustomerId("alpha")).toBe(false);
    expect(isCustomerId("not-a-uuid")).toBe(false);
  });

  it("validates task input without touching stored values", () => {
    expect(validateCustomerTaskInput({ title: "  ", kind: "setup" })).toContain("1~120자");
    expect(validateCustomerTaskInput({ title: "가".repeat(121), kind: "setup" })).toContain("1~120자");
    expect(validateCustomerTaskInput({ title: "안내", kind: "bogus" })).toContain("구분");
    expect(validateCustomerTaskInput({ title: "안내", kind: "support" })).toBeNull();
  });
});

describe("customers server boundary", () => {
  it("maps RPC errors to denied / not-found / invalid / unavailable", () => {
    expect(customerFailureFromRpcError({ code: "42501" })).toEqual({ ok: false, reason: "denied" });
    expect(customerFailureFromRpcError({ code: "P0002" })).toEqual({ ok: false, reason: "not-found" });
    expect(customerFailureFromRpcError({ code: "22023", message: "customer task kind invalid" }))
      .toEqual({ ok: false, reason: "invalid", message: "작업 구분을 확인해 주세요." });
    expect(customerFailureFromRpcError({ code: "22023", message: "something else" }))
      .toEqual({ ok: false, reason: "invalid", message: "입력값을 확인해 주세요." });
    expect(customerFailureFromRpcError({ code: "500" })).toEqual({ ok: false, reason: "unavailable" });
    expect(customerFailureFromRpcError({})).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reads the list and refuses malformed payloads instead of rendering zeros", async () => {
    const ok = stubClient({ list_platform_customers: () => [summary] });
    await expect(readPlatformCustomerList(ok, { search: "", status: "all" }))
      .resolves.toMatchObject({ ok: true, customers: [{ name: "알파 회사" }] });

    const broken = stubClient({ list_platform_customers: () => [{ ...summary, open_task_count: null }] });
    await expect(readPlatformCustomerList(broken, { search: "", status: "all" }))
      .resolves.toEqual({ ok: false, reason: "unavailable" });

    const denied = stubClient({ list_platform_customers: () => { throw rpcError("42501"); } });
    await expect(readPlatformCustomerList(denied, { search: "", status: "all" }))
      .resolves.toEqual({ ok: false, reason: "denied" });
  });

  it("reads detail as a bundle — one broken leg fails the whole panel", async () => {
    const ok = stubClient({
      get_platform_customer: () => detail,
      list_platform_customer_tasks: () => [],
      list_platform_customer_history: () => [],
    });
    const result = await readPlatformCustomerDetail(ok, summary.org_id as string);
    expect(result.ok && result.customer.name).toBe("알파 회사");

    const brokenTasks = stubClient({
      get_platform_customer: () => detail,
      list_platform_customer_tasks: () => [{ bad: true }],
      list_platform_customer_history: () => [],
    });
    await expect(readPlatformCustomerDetail(brokenTasks, summary.org_id as string))
      .resolves.toEqual({ ok: false, reason: "unavailable" });

    const missing = stubClient({ get_platform_customer: () => { throw rpcError("P0002", "customer not found"); } });
    await expect(readPlatformCustomerDetail(missing, summary.org_id as string))
      .resolves.toEqual({ ok: false, reason: "not-found" });
  });

  it("validates mutations before the RPC and surfaces no-op honestly", async () => {
    const setup = stubClient({ set_platform_customer_setup: () => ({ ok: true, changed: false }) });
    await expect(writeCustomerSetup(setup, "org", "bogus"))
      .resolves.toEqual({ ok: false, reason: "invalid", message: "도입 상태를 확인해 주세요." });
    await expect(writeCustomerSetup(setup, "org", "active"))
      .resolves.toEqual({ ok: true, changed: false });

    // 'active' 초대는 파생값이라 요청 자체를 막는다.
    const invite = stubClient({ record_platform_customer_invite: () => ({ ok: true, changed: true }) });
    await expect(writeCustomerInvite(invite, "org", "active"))
      .resolves.toEqual({ ok: false, reason: "invalid", message: "초대 상태는 발송 전·발송만 기록할 수 있어요." });

    const task = stubClient({ create_platform_customer_task: () => ({ ok: true, created: true }) });
    await expect(writeCustomerTask(task, "org", { taskId: "t", title: "  ", kind: "setup" }))
      .resolves.toEqual({ ok: false, reason: "invalid", message: "작업 내용을 1~120자로 입력해 주세요." });
    await expect(writeCustomerTask(task, "org", { taskId: "t", title: "안내", kind: "support" }))
      .resolves.toEqual({ ok: true, created: true, taskId: "t" });

    const status = stubClient({ update_platform_customer_task: () => ({ ok: true, changed: true }) });
    await expect(writeCustomerTaskStatus(status, "org", "t", "bogus"))
      .resolves.toEqual({ ok: false, reason: "invalid", message: "작업 상태를 확인해 주세요." });
  });
});
