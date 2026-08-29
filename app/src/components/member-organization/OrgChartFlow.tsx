import type { ReactElement } from "react";
import type { OrgMemberView, OrgViewModel } from "@/lib/org/org-view";

/**
 * #640 ② — 「조직도 한눈에 보기」.
 *
 * 목업 T.member 의 orgChart() 자리다. 세로로 쌓인 목록으로는 «누가 누구 밑인가» 가
 * 안 보인다 — 그 한 가지를 보이게 하는 것이 이 갈래의 전부다.
 *
 * ★ 이 1차에서 «안 하는 것»
 *   목업에는 「카드를 끌어 다른 부서에 놓으면 소속·보고 대상·공지 수신이 함께 바뀝니다」가
 *   적혀 있다. 그 «끌어 놓기» 는 조작이라 다음 단계다. 여기서는 보이게까지만 한다.
 *   화면에도 그렇게 적는다 — 없는 것을 「곧 나온다」고 말하지 않는다.
 *
 * ★ 375px
 *   조직도는 원래 옆으로 넓다. 몸통을 가로로 밀지 않고 «이 상자만» 밀리게 한다.
 */

type Node = OrgViewModel["departments"][number];

function MemberChips({ members, limit = 6 }: { members: OrgMemberView[]; limit?: number }): ReactElement | null {
  if (members.length === 0) return null;
  const shown = members.slice(0, limit);
  const rest = members.length - shown.length;
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-1">
      {shown.map((member) => (
        <span
          key={member.userId}
          className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          {member.displayName}
        </span>
      ))}
      {rest > 0 ? <span className="px-1 text-[11px] text-zinc-500">외 {rest}</span> : null}
    </div>
  );
}

function DeptCard({
  node,
  headName,
  members,
}: {
  node: Node;
  headName: string | null;
  members: OrgMemberView[];
}): ReactElement {
  return (
    <div
      data-department-id={node.id}
      className="w-44 shrink-0 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="truncate text-sm font-semibold">{node.name}</div>
      {headName ? (
        <div className="mt-0.5 truncate text-[11px] text-zinc-500">책임자 {headName}</div>
      ) : (
        // 공석은 «비어 있음» 이 아니라 «보고가 위로 넘어간다» 는 사실이다. 목업도 이걸 강조한다.
        <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">책임자 공석</div>
      )}
      <div className="mt-1 text-[11px] tabular-nums text-zinc-500">
        {node.memberCount}명
        {node.reachCount !== node.memberCount ? <span className="text-zinc-400"> · 하위 포함 {node.reachCount}</span> : null}
      </div>
      <MemberChips members={members} />
    </div>
  );
}

function Branch({
  node,
  model,
  childrenOf,
  membersOf,
  headNameOf,
}: {
  node: Node;
  model: OrgViewModel;
  childrenOf: (id: string) => Node[];
  membersOf: (id: string) => OrgMemberView[];
  headNameOf: (userId: string | null) => string | null;
}): ReactElement {
  const kids = childrenOf(node.id);
  return (
    <div className="flex flex-col items-center">
      <DeptCard node={node} headName={headNameOf(node.headUserId)} members={membersOf(node.id)} />
      {kids.length > 0 ? (
        <>
          {/* 부모에서 내려오는 줄기 */}
          <div className="h-4 w-px bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />
          <div className="flex items-start">
            {kids.map((kid, index) => (
              <div key={kid.id} className="relative flex flex-col items-center px-2 pt-4">
                {/*
                  ㄱ·ㅜ·ㄴ 모양 연결선. 첫 자식은 왼쪽 반을, 막내는 오른쪽 반을 비운다 —
                  그래야 바깥으로 삐져나온 선이 안 생긴다. 자식이 하나면 양쪽 다 비어 세로줄만 남는다.
                */}
                <div className="absolute inset-x-0 top-0 flex" aria-hidden="true">
                  <div className={`h-4 flex-1 ${index === 0 ? "" : "border-t border-zinc-300 dark:border-zinc-700"}`} />
                  <div className={`h-4 flex-1 ${index === kids.length - 1 ? "" : "border-t border-zinc-300 dark:border-zinc-700"}`} />
                </div>
                <div className="absolute top-0 h-4 w-px bg-zinc-300 dark:bg-zinc-700" aria-hidden="true" />
                <Branch node={kid} model={model} childrenOf={childrenOf} membersOf={membersOf} headNameOf={headNameOf} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function OrgChartFlow({ model }: { model: OrgViewModel }): ReactElement {
  const childrenOf = (id: string | null) => model.departments.filter((row) => row.parentId === id);
  const membersOf = (deptId: string) => model.members.filter((member) => member.departmentIds.includes(deptId));
  const nameOf = new Map(model.members.map((member) => [member.userId, member.displayName]));
  const headNameOf = (userId: string | null) => (userId ? nameOf.get(userId) ?? null : null);

  const roots = childrenOf(null);
  const unassigned = model.members.filter((member) => member.departmentIds.length === 0);

  if (roots.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 p-8 text-center dark:border-zinc-800">
        <p className="font-medium">아직 부서가 없어요</p>
        <p className="mt-1 text-sm text-zinc-500">
          부서를 만들면 여기에 누가 누구 밑인지 그림으로 보여요. 「목록」 갈래에서 부서를 먼저 만들어 주세요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 조직도는 원래 옆으로 넓다 — 몸통 대신 이 상자만 밀리게 한다(375px). */}
      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-zinc-50/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="flex min-w-max items-start gap-6">
          {roots.map((root) => (
            <Branch
              key={root.id}
              node={root}
              model={model}
              childrenOf={(id) => childrenOf(id)}
              membersOf={membersOf}
              headNameOf={headNameOf}
            />
          ))}
        </div>
      </div>

      {unassigned.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <b className="text-sm font-semibold">미배정 {unassigned.length}명</b>
          {/*
            ★ 전에는 「어느 부서에도 없어 보고가 대표에게 갑니다」라고 썼는데,
              이 상자에는 대표 본인도 들어온다. 대표는 아무에게도 보고하지 않는다
              (resolveReportsTo → null). 한 명이라도 최상위가 섞이면 그 문장은 거짓이다.
          */}
          <span className="ml-1 text-xs text-zinc-600 dark:text-zinc-300">
            · 어느 부서에도 속하지 않아요
            {unassigned.some((member) => member.reportsToUserId !== null)
              ? " — 최상위인 사람을 빼면 보고가 대표에게 갑니다"
              : ""}
          </span>
          <MemberChips members={unassigned} limit={12} />
        </div>
      ) : null}

      {/* 없는 것을 «곧 나온다» 고 말하지 않는다. 지금 무엇까지 되는지만 적는다. */}
      <p className="text-[11px] text-zinc-500">
        지금은 «보는 것»까지예요. 카드를 끌어 부서를 옮기는 기능은 아직 없어요 — 부서와 소속은 「목록」 갈래에서 바꿀 수 있어요.
      </p>
    </div>
  );
}
