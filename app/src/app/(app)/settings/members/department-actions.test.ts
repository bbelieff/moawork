import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import {
  assignDepartmentMemberAction,
  createDepartmentAction,
  moveDepartmentAction,
  renameDepartmentAction,
} from "./department-actions";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const DEPT = "00000000-0000-4000-8000-0000000000d1";
const USER = "00000000-0000-4000-8000-0000000000e1";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("#571 부서관리 server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ org: { id: ORG }, user: { id: USER }, role: "admin" });
    mocks.rpc.mockResolvedValue({ data: { accepted: true }, error: null });
  });

  it("조직 id는 form이 아니라 로그인 세션에서 고정하고 admin도 생성한다", async () => {
    const result = await createDepartmentAction(form({ name: " 운영 ", parentId: "", orgId: "other" }));
    expect(result).toEqual({ ok: true, message: "부서를 만들었어요." });
    expect(mocks.rpc).toHaveBeenCalledWith("manage_org_department_create", expect.objectContaining({
      p_org_id: ORG,
      p_parent_id: null,
      p_name: "운영",
      p_request_id: expect.any(String),
    }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/settings/members");
  });

  it("이름변경·상위변경·배정/해제를 각각 canonical manager RPC에 연결한다", async () => {
    await renameDepartmentAction(form({ departmentId: DEPT, name: "심사" }));
    await moveDepartmentAction(form({ departmentId: DEPT, parentId: "" }));
    await assignDepartmentMemberAction(form({ userId: USER, departmentId: DEPT }));
    await assignDepartmentMemberAction(form({ userId: USER, departmentId: "" }));
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "manage_org_department_rename",
      "manage_org_department_move",
      "manage_org_department_member",
      "manage_org_department_member",
    ]);
    expect(mocks.rpc.mock.calls[3][1]).toEqual(expect.objectContaining({ p_dept_id: null, p_org_id: ORG, p_user_id: USER }));
  });

  it("member는 RPC 전에 막고 UUID/name 오류도 서버에서 거부한다", async () => {
    mocks.session.mockResolvedValueOnce({ org: { id: ORG }, user: { id: USER }, role: "member" });
    expect(await createDepartmentAction(form({ name: "금지" }))).toEqual({ ok: false, message: "대표와 관리자만 조직도를 바꿀 수 있어요." });
    expect(await renameDepartmentAction(form({ departmentId: "other-org", name: "오류" }))).toEqual({ ok: false, message: "부서 이름을 1~80자로 입력해 주세요." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("DB 권한·구조 오류를 사용자가 이해할 수 있는 문장으로 바꾼다", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "organization manager required" } });
    expect(await createDepartmentAction(form({ name: "오류" }))).toEqual({ ok: false, message: "대표와 관리자만 조직도를 바꿀 수 있어요." });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "department move would create a cycle" } });
    expect(await moveDepartmentAction(form({ departmentId: DEPT, parentId: "00000000-0000-4000-8000-0000000000d2" }))).toEqual({ ok: false, message: "하위 부서를 자기 상위로 옮길 수 없어요." });
  });
});
