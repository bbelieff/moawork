import { describe, expect, it } from "vitest";
import {
  canRemoveDetailEvent,
  canRestoreDetailEvent,
  type DetailEventViewer,
} from "./detail-event-permissions";

/**
 * #672 — 「담당자가 되면 자동기록 과 자기가 작성한 히스토리 지울 수 있게 /
 *        이외 협업자들은 본인이 작성한 히스토리 / 회사대표는 모든권한」
 *
 * 여기서 재는 것은 «버튼을 보일까» 다. 막는 것은 서버(마이그레이션 144)이고
 * 그쪽 계약은 item-detail-feed.pglite.test.ts 가 잰다. 둘이 어긋나면
 * 못 누를 버튼이 보이거나, 누를 수 있는데 안 보이거나 한다.
 */

const OWNER = "user-owner";
const ASSIGNEE = "user-assignee";
const OTHER = "user-other";

const asOwner: DetailEventViewer = { viewerId: OWNER, viewerRole: "owner", assignedTo: ASSIGNEE };
const asAssignee: DetailEventViewer = { viewerId: ASSIGNEE, viewerRole: "member", assignedTo: ASSIGNEE };
const asOther: DetailEventViewer = { viewerId: OTHER, viewerRole: "member", assignedTo: ASSIGNEE };

const memoBy = (actorId: string | null) => ({ kind: "memo", actorId });
const auto = { kind: "field_change", actorId: null };

describe("#672 회사 대표는 전부", () => {
  it("남의 메모도 치운다", () => {
    expect(canRemoveDetailEvent(memoBy(OTHER), asOwner)).toBe(true);
  });

  it("자동 기록도 치운다", () => {
    expect(canRemoveDetailEvent(auto, asOwner)).toBe(true);
  });
});

describe("#672 담당자는 자동 기록 + 본인 것", () => {
  it("자기 메모를 치운다", () => {
    expect(canRemoveDetailEvent(memoBy(ASSIGNEE), asAssignee)).toBe(true);
  });

  it("★ 자동 기록을 치운다 — 담당자만 할 수 있는 일이다", () => {
    expect(canRemoveDetailEvent(auto, asAssignee)).toBe(true);
  });

  it("★ 남의 메모는 못 치운다", () => {
    expect(canRemoveDetailEvent(memoBy(OTHER), asAssignee)).toBe(false);
  });
});

describe("#672 그 밖의 협업자는 본인 것만", () => {
  it("자기 메모를 치운다", () => {
    expect(canRemoveDetailEvent(memoBy(OTHER), asOther)).toBe(true);
  });

  it("★ 자동 기록은 못 치운다 — 담당자가 아니다", () => {
    expect(canRemoveDetailEvent(auto, asOther)).toBe(false);
  });

  it("★ 남의 메모도 못 치운다", () => {
    expect(canRemoveDetailEvent(memoBy(ASSIGNEE), asOther)).toBe(false);
  });
});

describe("#672 빈 값이 «같다» 로 새지 않게", () => {
  it("로그인 전에는 아무것도 못 치운다", () => {
    expect(canRemoveDetailEvent(auto, { viewerId: null, viewerRole: "owner", assignedTo: null })).toBe(false);
  });

  it("★ actor 가 없는 기록을 «내 것» 으로 세지 않는다", () => {
    // 둘 다 null 이면 === 로는 같아진다. 그걸 막는지 본다.
    expect(canRemoveDetailEvent({ kind: "memo", actorId: null }, asOther)).toBe(false);
  });

  it("담당자가 정해지지 않은 아이템에서는 자동 기록을 아무도 못 치운다(대표 제외)", () => {
    const noAssignee: DetailEventViewer = { viewerId: OTHER, viewerRole: "member", assignedTo: null };
    expect(canRemoveDetailEvent(auto, noAssignee)).toBe(false);
  });

  it("자리를 모르면 «본인 것만» 으로 좁힌다", () => {
    const unknown: DetailEventViewer = { viewerId: OTHER, viewerRole: null, assignedTo: ASSIGNEE };
    expect(canRemoveDetailEvent(memoBy(OTHER), unknown)).toBe(true);
    expect(canRemoveDetailEvent(memoBy(ASSIGNEE), unknown)).toBe(false);
  });
});

describe("#672 되살리기는 «치운 사람» 과 대표만", () => {
  it("자기가 치운 것은 되살린다", () => {
    expect(canRestoreDetailEvent(OTHER, asOther)).toBe(true);
  });

  it("★ 남이 치운 것은 못 되살린다 — 그러면 「치웠다」가 의미를 잃는다", () => {
    expect(canRestoreDetailEvent(OWNER, asOther)).toBe(false);
  });

  it("대표는 누가 치웠든 되살린다", () => {
    expect(canRestoreDetailEvent(OTHER, asOwner)).toBe(true);
  });

  it("치워지지 않은 것에는 되살리기가 없다", () => {
    expect(canRestoreDetailEvent(null, asOther)).toBe(false);
  });
});
