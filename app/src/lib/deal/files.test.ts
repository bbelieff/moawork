import { beforeEach, describe, expect, it } from "vitest";
import type { Ctx, MemberRole, MemberScope } from "@/lib/types";
import { getRepo } from "@/lib/repo";
import { resetDb } from "@/lib/repo/local/store";
import { SEED_ORG_ID, SEED_USER_MEMBER, SEED_USER_OWNER } from "@/lib/repo/local/seed";
import { getCrmService } from "@/lib/crm";
import {
  DealFileNotFoundError,
  DealFileValidationError,
  attachDealFile,
  listDealFiles,
  readDealFileBytes,
  removeDealFile,
} from "./files";

function ctxFor(userId: string, role: MemberRole, scope: MemberScope): Ctx {
  const repo = getRepo();
  const user = repo.getUser(userId);
  const org = repo.getOrg(SEED_ORG_ID);
  if (!user || !org) throw new Error("seed 누락");
  return { user, org, role, scope };
}

let owner: Ctx;
let member: Ctx;

beforeEach(() => {
  resetDb();
  owner = ctxFor(SEED_USER_OWNER, "owner", "all");
  member = ctxFor(SEED_USER_MEMBER, "member", "assigned");
});

const SMALL_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("attachDealFile / listDealFiles", () => {
  it("첨부하면 메타 목록에 나타나고 바이트는 응답 객체에 없다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "첨부 테스트" });
    const meta = await attachDealFile(owner, deal.id, {
      name: "설명.png",
      mime_type: "image/png",
      size_bytes: 68,
      data_url: SMALL_PNG_DATA_URL,
    });

    expect(meta.name).toBe("설명.png");
    expect("content_b64" in meta).toBe(false);
    expect("data_url" in meta).toBe(false);

    const list = await listDealFiles(owner, deal.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(meta.id);
  });

  it("최신순으로 정렬된다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "정렬 테스트" });
    await attachDealFile(owner, deal.id, {
      name: "a.png",
      size_bytes: 10,
      data_url: SMALL_PNG_DATA_URL,
    });
    await attachDealFile(owner, deal.id, {
      name: "b.png",
      size_bytes: 10,
      data_url: SMALL_PNG_DATA_URL,
    });
    const list = await listDealFiles(owner, deal.id);
    expect(list.map((f) => f.name)).toEqual(["b.png", "a.png"]);
  });

  it("빈 파일(size_bytes=0)은 거부", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "빈 파일" });
    await expect(
      attachDealFile(owner, deal.id, { name: "empty.png", size_bytes: 0, data_url: "" }),
    ).rejects.toBeInstanceOf(DealFileValidationError);
  });

  it("차단 확장자는 거부", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "실행파일 차단" });
    await expect(
      attachDealFile(owner, deal.id, {
        name: "virus.exe",
        size_bytes: 100,
        data_url: SMALL_PNG_DATA_URL,
      }),
    ).rejects.toBeInstanceOf(DealFileValidationError);
  });

  it("다른 custom 값(댓글 등)을 지우지 않는다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "custom 보존" });
    await getCrmService().updateDeal(owner, deal.id, { custom: { 계약상황: "진행중" } });
    await attachDealFile(owner, deal.id, {
      name: "a.png",
      size_bytes: 10,
      data_url: SMALL_PNG_DATA_URL,
    });
    const after = await getCrmService().getDeal(owner, deal.id);
    expect(after.custom?.["계약상황"]).toBe("진행중");
  });

  it("member 는 남의 딜에 첨부할 수 없다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "오너 딜" });
    await expect(
      attachDealFile(member, deal.id, {
        name: "a.png",
        size_bytes: 10,
        data_url: SMALL_PNG_DATA_URL,
      }),
    ).rejects.toThrow();
  });
});

describe("removeDealFile", () => {
  it("삭제하면 목록에서 사라진다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "삭제 테스트" });
    const meta = await attachDealFile(owner, deal.id, {
      name: "a.png",
      size_bytes: 10,
      data_url: SMALL_PNG_DATA_URL,
    });
    await removeDealFile(owner, deal.id, meta.id);
    expect(await listDealFiles(owner, deal.id)).toHaveLength(0);
  });

  it("없는 파일이면 DealFileNotFoundError", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "없는 파일" });
    await expect(removeDealFile(owner, deal.id, "없는id")).rejects.toBeInstanceOf(
      DealFileNotFoundError,
    );
  });
});

describe("readDealFileBytes — 다운로드 라우트 전용", () => {
  it("저장된 base64 를 원본 바이트로 복원한다", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "바이트 복원" });
    const meta = await attachDealFile(owner, deal.id, {
      name: "a.png",
      size_bytes: 10,
      data_url: SMALL_PNG_DATA_URL,
    });

    const found = await readDealFileBytes(owner, deal.id, meta.id);
    expect(found).not.toBeNull();
    // data: 접두사를 뗀 순수 base64 페이로드와 동일해야 한다.
    const expectedBytes = Buffer.from(SMALL_PNG_DATA_URL.split(",")[1], "base64");
    expect(found!.buffer.equals(expectedBytes)).toBe(true);
  });

  it("없는 파일이면 null", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "없음" });
    expect(await readDealFileBytes(owner, deal.id, "없는id")).toBeNull();
  });

  it("member 는 남의 딜 파일 바이트를 읽을 수 없다(getDeal 이 먼저 막는다)", async () => {
    const deal = await getCrmService().createDeal(owner, { title: "오너 딜" });
    const meta = await attachDealFile(owner, deal.id, {
      name: "a.png",
      size_bytes: 10,
      data_url: SMALL_PNG_DATA_URL,
    });
    await expect(readDealFileBytes(member, deal.id, meta.id)).rejects.toThrow();
  });
});
