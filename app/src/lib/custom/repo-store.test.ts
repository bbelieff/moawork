/**
 * 정합 검증 — 순수 엔진이 공용 `@/lib/repo`(LocalRepo) 위에서 동작하는지.
 * org_id 스코핑으로 테스트끼리 격리한다(전역 store 공유).
 */

import { describe, it, expect } from "vitest";
import { RepoCustomStore } from "./repo-store";
import { CustomService } from "./service";
import { ValidationError } from "./field-types";

let seq = 0;
function makeService() {
  let n = 0;
  return new CustomService(new RepoCustomStore(), () => `opt-${++n}`);
}
function orgId(): string {
  return `org-rs-${++seq}`;
}

describe("repo-store: 공용 Repo 위 엔진 동작", () => {
  it("필드 생성 → 값 정규화 저장 → 조회 round-trip", async () => {
    const org = orgId();
    const svc = makeService();
    const def = await svc.createField(org, { entity: "deal", label: "Score", type: "number" });
    expect(def.key).toBe("score");
    expect(def.org_id).toBe(org);

    // "42"(문자열) → 42(숫자)로 정규화되어 저장되어야 한다.
    expect(await svc.setValues(org, "deal", "deal-1", { score: "42" })).toEqual({ score: 42 });
    expect(await svc.getValues(org, "deal", "deal-1")).toEqual({ score: 42 });
  });

  it("select 옵션 id 검증이 공용 저장소 경로에서도 적용된다", async () => {
    const org = orgId();
    const svc = makeService();
    const def = await svc.createField(org, {
      entity: "deal",
      label: "Priority",
      type: "select",
      optionLabels: ["Low", "High"],
    });
    const okId = def.options_jsonb!.options[0].id;
    expect(await svc.setValues(org, "deal", "d1", { [def.key]: okId })).toEqual({
      [def.key]: okId,
    });
    await expect(svc.setValues(org, "deal", "d1", { [def.key]: "bogus" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("org 격리 — 다른 org 의 정의가 보이지 않는다", async () => {
    const a = orgId();
    const b = orgId();
    const svc = makeService();
    await svc.createField(a, { entity: "deal", label: "OnlyA", type: "text" });
    expect((await svc.listFields(a, "deal")).map((d) => d.label)).toContain("OnlyA");
    expect(await svc.listFields(b, "deal")).toEqual([]);
  });

  it("정의 삭제 후 값이 남고 같은 key 재생성 시 재노출된다", async () => {
    const org = orgId();
    const svc = makeService();
    const def = await svc.createField(org, { entity: "deal", label: "Temp", type: "text" });
    await svc.setValues(org, "deal", "d1", { [def.key]: "x" });
    expect(await svc.getValues(org, "deal", "d1")).toEqual({ [def.key]: "x" });

    expect(await svc.deleteField(org, def.id)).toBe(true);
    expect(await svc.getValues(org, "deal", "d1")).toEqual({});
    const reloaded = new CustomService(new RepoCustomStore(), () => "reload-option");
    expect(await reloaded.getValues(org, "deal", "d1")).toEqual({});
    await reloaded.createField(org, { entity: "deal", key: def.key, label: "Temp restored", type: "text" });
    expect(await reloaded.getValues(org, "deal", "d1")).toEqual({ [def.key]: "x" });
  });

  it("저장뷰 — 개인/공유 가시성 + 기본뷰 규약(shared 우선)", async () => {
    const org = orgId();
    const svc = makeService();
    const cfg = { filters: [], sorts: [], columns: [] };
    await svc.createView(org, "u1", { entity: "deal", name: "zzz-shared", config: cfg, shared: true });
    await svc.createView(org, "u1", { entity: "deal", name: "aaa-mine", config: cfg, shared: false });
    await svc.createView(org, "u2", { entity: "deal", name: "other", config: cfg, shared: false });

    const mine = await svc.listViews(org, "u1", "deal");
    expect(mine.map((v) => v.name).sort()).toEqual(["aaa-mine", "zzz-shared"]);

    // shared 우선이므로 이름이 뒤여도 공유 뷰가 기본.
    const def = await svc.getDefaultView(org, "u1", "deal");
    expect(def?.name).toBe("zzz-shared");
  });

  it("뷰 config 왕복 — filters/sorts 가 jsonb 를 거쳐 보존된다", async () => {
    const org = orgId();
    const svc = makeService();
    const view = await svc.createView(org, "u1", {
      entity: "deal",
      name: "hot",
      shared: false,
      config: {
        filters: [{ fieldKey: "score", operator: "gt", value: 50 }],
        sorts: [{ fieldKey: "score", direction: "desc" }],
        columns: ["score"],
      },
    });
    const back = svc.viewConfigOf(view);
    expect(back.filters).toEqual([{ fieldKey: "score", operator: "gt", value: 50 }]);
    expect(back.sorts).toEqual([{ fieldKey: "score", direction: "desc" }]);
    expect(back.columns).toEqual(["score"]);
  });
});
