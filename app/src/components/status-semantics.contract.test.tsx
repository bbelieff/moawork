import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// BBE-193 — 「판정 근거는 응답에 있는데 표현이 그걸 안 읽는다」 결함의 회귀 방지.
//
// ★ 이 파일이 지키는 계약 한 줄:
//   **성공은 role="status" + 긍정 표현, 실패는 role="alert" + 오류 표현.**
//   role 만 분기하거나 색만 분기하면 «반쪽 진실» 이라 둘 다 실패로 본다.
//
// 저장소에 이미 있던 정답: LockBlockedDialog:88 · AccountState:22.
//
// ★ 각 테스트에 «무엇을 되돌리면 빨개지는가» 를 적는다. 되돌려도 초록이면 그 테스트는 무력하다.
//
// 검증 환경 한계: 이 저장소에는 jsdom·testing-library 가 없어 클릭을 흉내낼 수 없다. 그래서
//   (a) props 로 상태가 정해지는 것은 그대로 렌더하고,
//   (b) useActionState 로 정해지는 것은 그 훅만 갈아끼워 렌더하고,
//   (c) 클릭이 필요한 것은 «판정» 을 순수 함수로 떼어내 실패 경로까지 직접 부른다.

const ROLE_STATUS = 'role="status"';
const ROLE_ALERT = 'role="alert"';

/** useActionState 가 돌려줄 상태를 시험용으로 고정한다. 나머지 react API 는 진짜를 쓴다. */
function mockActionState(state: unknown) {
  vi.doMock("react", async () => {
    const actual = await vi.importActual<typeof import("react")>("react");
    return { ...actual, useActionState: () => [state, () => {}, false] };
  });
}

function sourceOf(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("BBE-193 성공/실패 표현 계약", () => {
  // react 를 갈아끼운 시험이 다음 시험으로 새지 않게 매번 되돌린다.
  // (안 하면 EsignPanel 이 앞 시험의 useActionState 를 물고 와 엉뚱하게 통과/실패한다.)
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("react");
  });

  // ── 1순위. 딜을 다음 단계로 넘기는 조작. BBE-172(#244)가 이 경로를 태운다 ──
  // 되돌리면 빨개진다: ContactPipelineAction 의 role 을 "status" 로 고정
  describe("ContactPipelineAction — 리드/컨택 이동", () => {
    async function render(state: { ok: boolean; message: string }) {
      vi.resetModules();
      mockActionState(state);
      const { ContactPipelineAction } = await import("./crm/ContactPipelineAction");
      return renderToStaticMarkup(
        <ContactPipelineAction dealId="deal-1" kind="lead_to_contact" requestId="req-1" />,
      );
    }

    it("이동 실패를 «정중하게» 알리지 않는다", async () => {
      const html = await render({ ok: false, message: "이동하지 못했어요." });
      expect(html).toContain("이동하지 못했어요.");
      expect(html).toContain(ROLE_ALERT);
      expect(html).not.toContain(ROLE_STATUS);
      expect(html).toContain("--mw-error");
    });

    it("이동 성공은 status 와 긍정 표현으로 알린다", async () => {
      const html = await render({ ok: true, message: "컨택으로 옮겼어요." });
      expect(html).toContain(ROLE_STATUS);
      expect(html).not.toContain(ROLE_ALERT);
      expect(html).toContain("--mw-success");
    });
  });

  // ── 2순위. state.ok 가 있는데 렌더가 한 번도 안 읽던 곳 ──
  // 되돌리면 빨개진다: EsignPanel 의 role/색 분기를 고정값으로 되돌리기
  describe("EsignPanel — 전자계약", () => {
    it("상태 읽기 실패는 alert 로, 정상 안내는 status 로 알린다", async () => {
      const { EsignPanel } = await import("./deal/EsignPanel");
      const failed = renderToStaticMarkup(
        <EsignPanel dealId="deal-1" initialStatus={null} initialError canEdit />,
      );
      const ok = renderToStaticMarkup(<EsignPanel dealId="deal-1" initialStatus="요청됨" canEdit />);

      expect(failed).toContain(ROLE_ALERT);
      expect(failed).toContain("전자계약 상태를 불러오지 못했어요.");
      expect(failed).toContain("--mw-error");

      expect(ok).toContain(ROLE_STATUS);
      expect(ok).not.toContain(ROLE_ALERT);
      expect(ok).not.toContain("--mw-error");
    });

    // 되돌리면 빨개진다: --mw-line/--mw-sub 를 --mw-border/--mw-text-muted 로 되돌리기
    it("정의된 적 없는 토큰을 참조하지 않는다", () => {
      const source = sourceOf("./deal/EsignPanel.tsx");
      expect(source).not.toContain("var(--mw-border)");
      expect(source).not.toContain("var(--mw-text-muted)");
    });
  });

  // ── 2순위. 권한 거부와 성공이 글자 크기까지 똑같던 곳 ──
  describe("LedgerExportButton — 원장 CSV 내보내기", () => {
    const allow = async () => ({ ok: true }) as const;
    const deny = async () => ({ ok: false, message: "CSV를 내보낼 권한이 없어요." }) as const;
    const load = () => import("./accounting/LedgerExportButton");

    // 되돌리면 빨개진다: 권한 거부를 ok:true 로 되돌리기
    it("권한 거부는 실패로 남는다", async () => {
      const { resolveLedgerExportFeedback } = await load();
      expect(await resolveLedgerExportFeedback(deny, () => ({ rowCount: 3 })))
        .toEqual({ ok: false, message: "CSV를 내보낼 권한이 없어요." });
    });

    // ★ 되돌리면 빨개진다: catch 가 ok:true 를 돌려주도록 되돌리기.
    // BBE-183 검수 FAIL 1순위 사유가 «실패 경로가 실패로 안 남는 것» 이었다.
    it("파일 만들기가 throw 하면 성공으로 삼키지 않는다", async () => {
      const { resolveLedgerExportFeedback } = await load();
      const feedback = await resolveLedgerExportFeedback(allow, () => {
        throw new Error("기간이 뒤집혔다");
      });
      expect(feedback.ok).toBe(false);
      expect(feedback.message).toBe("기간을 다시 확인해 주세요.");
    });

    it("권한 확인 자체가 throw 해도 실패로 남는다", async () => {
      const { resolveLedgerExportFeedback } = await load();
      const feedback = await resolveLedgerExportFeedback(
        async () => { throw new Error("네트워크"); },
        () => ({ rowCount: 3 }),
      );
      expect(feedback.ok).toBe(false);
    });

    it("정상 경로만 성공이다", async () => {
      const { resolveLedgerExportFeedback } = await load();
      expect(await resolveLedgerExportFeedback(allow, () => ({ rowCount: 3 })))
        .toEqual({ ok: true, message: "3건을 엑셀용 CSV로 준비했어요." });
    });

    // 되돌리면 빨개진다: 렌더에서 role/class 분기를 지우고 role="status" 고정으로 되돌리기
    it("판정을 role 과 색에 «함께» 반영한다", () => {
      const source = sourceOf("./accounting/LedgerExportButton.tsx");
      expect(source).toContain('role={feedback.ok ? "status" : "alert"}');
      expect(source).toContain("feedback.ok ? styles.exportOk : styles.exportFailed");
    });
  });

  // ── 3순위. 업무 셀 저장 실패가 조용히 지나가던 곳 ──
  // 되돌리면 빨개진다: WorkBoardSurface 의 role 을 "status" 로 고정
  describe("WorkBoardSurface — 업무 셀 저장", () => {
    it("셀 저장 실패는 alert 로 알린다", async () => {
      vi.resetModules();
      vi.doMock("@/app/(app)/work/actions", () => ({ mutateWork: async () => ({ ok: false, message: "" }) }));
      mockActionState({ ok: false, message: "저장하지 못했어요." });

      const { WORK_COLUMNS, WORK_TEMPLATE } = await import("@/lib/work-management");
      const { WorkBoardSurface } = await import("./work-management/WorkBoardSurface");
      const html = renderToStaticMarkup(<WorkBoardSurface snapshot={{
        board: { id: "b", orgId: "o", title: "업무관리", icon: "🔥", templateKey: WORK_TEMPLATE.key, templateVersion: 1, baselineFingerprint: WORK_TEMPLATE.baselineFingerprint, currentFingerprint: "edited" },
        groups: [{ id: "g", name: "준비단계", color: "#579bfc", count: 1 }],
        columns: WORK_COLUMNS,
        items: [{ id: "i", boardId: "b", groupId: "g", title: "업무", assignedTo: "u", workflowStatus: "in_progress", dueDate: "2026-08-04", version: 1, templateVersion: 1, companyRef: null, contactRef: null, companyDisplay: null, contactDisplay: null, provenance: { sourceKind: "synthetic", sourceRecordId: "s", immutable: true }, values: {}, updates: [], activities: [] }],
        members: [{ membershipId: "m", orgId: "o", userId: "u", displayName: "구성원", active: true }],
        views: [{ id: "v", name: "메인 테이블", kind: "table", shared: true, isDefault: true, version: 1, predicate: {} }],
        virtualBindings: [],
        role: "manager",
        filesEnabled: false,
      }}/>);

      expect(html).toContain("저장하지 못했어요.");
      expect(html).toContain(ROLE_ALERT);
    });

    // 되돌리면 빨개진다: .success/.error 를 hex(#00854a·#b42318)로 되돌리기
    it("상태 색을 브랜드 토큰으로만 잡는다", () => {
      const css = sourceOf("./work-management/work-management.module.css");
      expect(css).toContain(".success{color:var(--mw-success)}");
      expect(css).toContain(".error{color:var(--mw-error)}");
      expect(css).not.toContain("#00854a");
      expect(css).not.toContain("#b42318");
    });
  });

  // ── 4순위. 정합성 깨짐 경고가 «회색 안내문» 이던 곳 ──
  describe("DealLedgerPanel — 원장 정합성", () => {
    const entries = [
      { id: "fee-1", dealId: "deal-1", kind: "fee" as const, amount: 50_000, receivedAmount: 20_000, occurredOn: "2026-08-02", paidOn: null, attributionMonth: "2026-08-01" },
    ];

    // 되돌리면 빨개진다: noticeFailed 를 떼고 회색 .notice 만 남기기
    it("경고는 안내문과 «다르게 보인다»", async () => {
      const { DealLedgerPanel } = await import("./accounting/DealLedgerPanel");
      const mismatch = renderToStaticMarkup(
        <DealLedgerPanel dealId="deal-1" state={{ kind: "ready", entries, expectedFeeTotal: 49_999 }} />,
      );
      const unavailable = renderToStaticMarkup(<DealLedgerPanel dealId="deal-1" state={{ kind: "error" }} />);
      const empty = renderToStaticMarkup(
        <DealLedgerPanel dealId="deal-1" state={{ kind: "ready", entries: [], expectedFeeTotal: 0 }} />,
      );
      const loading = renderToStaticMarkup(<DealLedgerPanel dealId="deal-1" state={{ kind: "loading" }} />);

      for (const html of [mismatch, unavailable]) {
        expect(html).toContain(ROLE_ALERT);
        expect(html).toMatch(/noticeFailed/);
      }
      // 경고가 아닌 둘까지 빨개지면 경고가 묻힌다 — «전부 빨갛게» 로 도망가는 것도 막는다.
      for (const html of [empty, loading]) {
        expect(html).not.toContain(ROLE_ALERT);
        expect(html).not.toMatch(/noticeFailed/);
      }
    });
  });

  // ── ★ 소비처 검사 — 컴포넌트 «안» 만 고치고 «밖» 이 무방비였던 것이 BBE-183 검수 FAIL 사유였다 ──
  describe("소비처", () => {
    // 되돌리면 빨개진다: 소비처에서 해당 컴포넌트 렌더를 지우기
    it.each([
      ["ContactPipelineAction", "./board/BoardWorkspace.tsx"],
      ["EsignPanel", "../app/(app)/deals/[dealId]/page.tsx"],
      ["WorkBoardSurface", "./work-management/NotificationWorkBoard.tsx"],
    ])("%s 는 소비처가 실제로 화면에 붙인다", (name, consumer) => {
      const source = sourceOf(consumer);
      expect(source).toContain(`import { ${name} }`);
      // ★ 요소 경계까지 본다. `toContain()` 로 하면 <XxxRemoved 같은 이름에도
      // 그대로 통과해 «화면에서 떼어냈다» 를 놓친다 — 뮤테이션 ⑬ 이 실제로 뚫었던 구멍이다.
      expect(source).toMatch(new RegExp("<" + name + "[\\s/>]"));
    });

    // ★ 이 둘은 붙는 화면이 없다(AGENTS §1.3 의 «52개 파일» 문제).
    // 고쳐는 뒀지만 ⑦ 화면 확인이 원천적으로 불가능하다는 사실을 테스트로 «드러내» 둔다.
    // 소비처가 생기면 이 테스트가 빨개진다 → 그때 위 목록으로 옮기고 화면 증거를 남기면 된다.
    it("회계 두 곳은 아직 어느 화면에도 붙지 않는다 — 붙는 순간 빨개진다", () => {
      // ★ src 전체를 훑는다. 예전엔 "../app" 이라 app/ 만 봤는데, 이 두 부품이 실제로 붙을
      //   자리는 components/ 다 — 이 파일 위쪽이 소비처로 적은 BoardWorkspace 부터가 components/ 다.
      //   즉 «소비처가 생기는 바로 그 자리» 가 사각지대였다(검수 지적).
      const appDir = fileURLToPath(new URL("..", import.meta.url));
      const sources: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) sources.push(readFileSync(full, "utf8"));
        }
      };
      walk(appDir);

      for (const orphan of ["LedgerExportButton", "DealLedgerPanel"]) {
        const mountedBy = sources.filter((source) => source.includes(`<${orphan}`));
        expect(mountedBy, `${orphan} 의 소비처가 생겼다면 ⑦ 증거를 남기고 이 목록을 갱신해라`).toHaveLength(0);
      }
    });
  });
});
