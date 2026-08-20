import { describe, it, expect, beforeEach } from "vitest";
import type { Ctx, Deal } from "@/lib/types";
import { mergeCustom } from "@/lib/repo/custom-merge";
import type { DealFilesPort } from "./files";
import {
  appendFileRef,
  attachFile,
  buildStoragePath,
  countDealFiles,
  DealNotFoundError,
  extensionOf,
  FileValidationError,
  FILES_CUSTOM_KEY,
  formatBytes,
  getFile,
  listDealFiles,
  MAX_FILE_BYTES,
  readFileRefs,
  removeFile,
  removeFileRef,
  sanitizeFileName,
  validateUpload,
  type DealFileRef,
} from "./files";

function ctxOf(orgId: string, userId = "u1"): Ctx {
  return {
    user: { id: userId, email: null, name: null, avatar_url: null, created_at: "" },
    org: { id: orgId, name: "테스트", plan_tier: "t1_3", created_at: "" },
    role: "owner",
    scope: "all",
  } as Ctx;
}

const ctx = ctxOf("o1");

function makeDeal(id: string, orgId = "o1"): Deal {
  return {
    id,
    org_id: orgId,
    company_id: null,
    pipeline_id: null,
    stage_id: null,
    assigned_to: null,
    title: `딜 ${id}`,
    amount: null,
    status_note: null,
    fee_terms: null,
    applied_on: null,
    custom: {},
    created_at: "2026-07-21T00:00:00.000Z",
    updated_at: "2026-07-21T00:00:00.000Z",
  };
}

/**
 * org 스코핑을 흉내내는 가짜 포트. 최소 포트만 구현하므로 Repo 전체 형태와 무관.
 * custom 병합은 진짜 구현과 **같은 함수**(mergeCustom)를 쓴다 — 가짜가 실제보다
 * 관대하면(혹은 엄격하면) 이 파일의 테스트가 현실을 검증하지 못한다.
 */
function fakeRepo(deals: Deal[]): DealFilesPort {
  const byId = new Map(deals.map((d) => [d.id, { ...d }]));
  return {
    getDeal: (c, id) => {
      const d = byId.get(id);
      return d && d.org_id === c.org.id ? d : undefined;
    },
    updateDeal: (c, id, patch) => {
      const d = byId.get(id);
      if (!d || d.org_id !== c.org.id) return undefined;
      const next = {
        ...d,
        ...(patch.custom ? { custom: mergeCustom(d.custom, patch.custom) } : {}),
      };
      byId.set(id, next);
      return next;
    },
  };
}

/** 결정적 id/시각 주입. */
function deterministic() {
  let n = 0;
  let t = 0;
  return {
    genId: () => `f${++n}`,
    now: () => `2026-07-21T00:00:0${t++}.000Z`,
  };
}

let seq: ReturnType<typeof deterministic>;
beforeEach(() => {
  seq = deterministic();
});

// ── 확장자 ───────────────────────────────────────────────

describe("extensionOf", () => {
  it("마지막 확장자를 소문자로 뽑는다", () => {
    expect(extensionOf("계약서.PDF")).toBe("pdf");
    expect(extensionOf("a.tar.gz")).toBe("gz");
  });

  it("확장자가 없으면 null", () => {
    expect(extensionOf("README")).toBeNull();
    expect(extensionOf("trailing.")).toBeNull();
    expect(extensionOf(".gitignore")).toBeNull();
  });

  it("경로가 섞여도 파일명 기준", () => {
    expect(extensionOf("C:\\tmp\\문서.docx")).toBe("docx");
    expect(extensionOf("/var/tmp/문서.hwp")).toBe("hwp");
  });
});

// ── 파일명 정규화 ────────────────────────────────────────

describe("sanitizeFileName", () => {
  it("경로 구분자를 제거하고 파일명만 남긴다(디렉터리 탈출 방지)", () => {
    expect(sanitizeFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFileName("C:\\Windows\\system.ini")).toBe("system.ini");
  });

  it("위험문자를 _ 로 치환한다", () => {
    expect(sanitizeFileName('보고서<>:"|?*.pdf')).toBe("보고서_______.pdf");
  });

  it("한글·숫자·공백은 보존한다", () => {
    expect(sanitizeFileName("2026년 계약서 v2.pdf")).toBe("2026년 계약서 v2.pdf");
  });

  it("선행 점을 제거한다", () => {
    expect(sanitizeFileName("...hidden.txt")).toBe("_hidden.txt");
  });

  it("빈 이름은 untitled", () => {
    expect(sanitizeFileName("   ")).toBe("untitled");
    expect(sanitizeFileName("/")).toBe("untitled");
  });

  it("과도한 길이를 자른다", () => {
    expect(sanitizeFileName("a".repeat(500)).length).toBe(200);
  });
});

// ── 업로드 검증 ──────────────────────────────────────────

describe("validateUpload", () => {
  it("정상 파일은 통과", () => {
    expect(validateUpload({ name: "계약서.pdf", size_bytes: 1024 })).toEqual({ ok: true });
  });

  it("실행/스크립트 확장자는 차단", () => {
    for (const bad of ["a.exe", "a.bat", "a.sh", "a.ps1", "a.js", "a.jar"]) {
      expect(validateUpload({ name: bad, size_bytes: 10 }).ok).toBe(false);
    }
  });

  it("확장자 대문자도 차단한다", () => {
    expect(validateUpload({ name: "악성.EXE", size_bytes: 10 }).ok).toBe(false);
  });

  it("크기 제한을 넘으면 차단", () => {
    const r = validateUpload({ name: "big.pdf", size_bytes: MAX_FILE_BYTES + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("10MB");
  });

  it("경계값(정확히 최대)은 허용", () => {
    expect(validateUpload({ name: "max.pdf", size_bytes: MAX_FILE_BYTES }).ok).toBe(true);
  });

  it("빈 파일·빈 이름·확장자 없음은 차단", () => {
    expect(validateUpload({ name: "a.pdf", size_bytes: 0 }).ok).toBe(false);
    expect(validateUpload({ name: "  ", size_bytes: 10 }).ok).toBe(false);
    expect(validateUpload({ name: "README", size_bytes: 10 }).ok).toBe(false);
  });

  it("비정상 크기는 차단", () => {
    expect(validateUpload({ name: "a.pdf", size_bytes: Number.NaN }).ok).toBe(false);
    expect(validateUpload({ name: "a.pdf", size_bytes: -1 }).ok).toBe(false);
  });
});

// ── 저장 경로 / 크기 표기 ────────────────────────────────

describe("buildStoragePath", () => {
  it("org_id 를 첫 세그먼트로 둔다(버킷 RLS 격리용)", () => {
    const p = buildStoragePath("org-1", "deal-2", "file-3", "계약서.pdf");
    expect(p).toBe("org-1/deal-2/file-3__계약서.pdf");
    expect(p.split("/")[0]).toBe("org-1");
  });

  it("파일명을 정규화해 경로 탈출을 막는다", () => {
    const p = buildStoragePath("o", "d", "f", "../../evil.txt");
    expect(p).toBe("o/d/f__evil.txt");
    expect(p).not.toContain("..");
  });
});

describe("formatBytes", () => {
  it("단위를 붙인다", () => {
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(2048)).toBe("2.0KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0MB");
  });
  it("비정상 값은 '—'", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

// ── jsonb 헬퍼 (DQ-0014 판정: deal.custom.files[]) ───────

const ref = (id: string): DealFileRef => ({
  id,
  name: `${id}.pdf`,
  mime_type: "application/pdf",
  size_bytes: 10,
  uploaded_by: "u1",
  created_at: "2026-07-21T00:00:00.000Z",
});

describe("readFileRefs", () => {
  it("custom.files 배열을 읽는다", () => {
    expect(readFileRefs({ [FILES_CUSTOM_KEY]: [ref("a")] })).toHaveLength(1);
  });

  it("없거나 배열이 아니면 빈 배열(방어)", () => {
    expect(readFileRefs(undefined)).toEqual([]);
    expect(readFileRefs(null)).toEqual([]);
    expect(readFileRefs({})).toEqual([]);
    expect(readFileRefs({ [FILES_CUSTOM_KEY]: "문자열" })).toEqual([]);
    expect(readFileRefs({ [FILES_CUSTOM_KEY]: 42 })).toEqual([]);
  });

  it("형식이 어긋난 원소는 걸러낸다", () => {
    const got = readFileRefs({
      [FILES_CUSTOM_KEY]: [ref("ok"), null, 3, { name: "id없음" }, { id: 1 }],
    });
    expect(got.map((f) => f.id)).toEqual(["ok"]);
  });
});

describe("appendFileRef / removeFileRef", () => {
  it("다른 custom 키를 보존한다", () => {
    const custom = { contract_status: "written", [FILES_CUSTOM_KEY]: [ref("a")] };
    const next = appendFileRef(custom, ref("b"));
    expect(next.contract_status).toBe("written");
    expect(readFileRefs(next).map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("원본을 변경하지 않는다(불변)", () => {
    const custom = { [FILES_CUSTOM_KEY]: [ref("a")] };
    appendFileRef(custom, ref("b"));
    expect(readFileRefs(custom).map((f) => f.id)).toEqual(["a"]);
  });

  it("제거는 해당 id 만 뺀다", () => {
    const custom = appendFileRef(appendFileRef({}, ref("a")), ref("b"));
    expect(readFileRefs(removeFileRef(custom, "a")).map((f) => f.id)).toEqual(["b"]);
  });

  it("없는 id 제거는 무해", () => {
    const custom = appendFileRef({}, ref("a"));
    expect(readFileRefs(removeFileRef(custom, "없음")).map((f) => f.id)).toEqual(["a"]);
  });
});

// ── 서비스 (Repo 경유) ───────────────────────────────────

describe("attachFile", () => {
  it("deal.custom.files[] 에 저장된다", () => {
    const repo = fakeRepo([makeDeal("d1")]);
    const f = attachFile(ctx, "d1", { name: "계약서.pdf", size_bytes: 100 }, { repo, ...seq });

    expect(f.uploaded_by).toBe("u1");
    // 실제 저장 위치 확인 — 별도 테이블이 아니라 딜의 jsonb
    const deal = repo.getDeal(ctx, "d1");
    expect(readFileRefs(deal?.custom).map((x) => x.id)).toEqual([f.id]);
  });

  it("파일명을 정규화해 저장한다", () => {
    const repo = fakeRepo([makeDeal("d1")]);
    const f = attachFile(ctx, "d1", { name: "../../evil.pdf", size_bytes: 10 }, { repo, ...seq });
    expect(f.name).toBe("evil.pdf");
  });

  it("기존 custom 필드(계약상황)를 덮어쓰지 않는다", () => {
    const d = makeDeal("d1");
    d.custom = { contract_status: "written" };
    const repo = fakeRepo([d]);
    attachFile(ctx, "d1", { name: "a.pdf", size_bytes: 10 }, { repo, ...seq });
    expect(repo.getDeal(ctx, "d1")?.custom.contract_status).toBe("written");
  });

  // BUG-0003 이후: Repo.updateDeal 이 custom 을 키 단위로 병합한다(통째 교체 아님).
  //   여기서는 files 서비스가 그 위에서도 자기 몫(files[] 갱신)을 정확히 하는지 본다.
  //   포트 자체의 병합 규약 회귀는 repo/local/localRepo.test.ts · repo/custom-merge.test.ts.
  it("타 트랙 custom 값(T05·T09)을 첨부/삭제 양쪽에서 보존한다", () => {
    const d = makeDeal("d1");
    d.custom = {
      contract_status: "written", // T05 커스텀필드
      exec_amount: 100_000_000, // T09 정책자금
      fee_pct: 3,
      fee_paid_at: "2026-07-01",
    };
    const repo = fakeRepo([d]);

    const f1 = attachFile(ctx, "d1", { name: "a.pdf", size_bytes: 10 }, { repo, ...seq });
    attachFile(ctx, "d1", { name: "b.pdf", size_bytes: 10 }, { repo, ...seq });

    const afterAttach = repo.getDeal(ctx, "d1")?.custom ?? {};
    expect(afterAttach.contract_status).toBe("written");
    expect(afterAttach.exec_amount).toBe(100_000_000);
    expect(afterAttach.fee_pct).toBe(3);
    expect(afterAttach.fee_paid_at).toBe("2026-07-01");
    expect(readFileRefs(afterAttach)).toHaveLength(2);

    // 삭제 경로도 동일하게 보존해야 한다.
    removeFile(ctx, "d1", f1.id, { repo });
    const afterRemove = repo.getDeal(ctx, "d1")?.custom ?? {};
    expect(afterRemove.contract_status).toBe("written");
    expect(afterRemove.exec_amount).toBe(100_000_000);
    expect(readFileRefs(afterRemove)).toHaveLength(1);
  });

  it("검증 실패 시 FileValidationError", () => {
    const repo = fakeRepo([makeDeal("d1")]);
    expect(() =>
      attachFile(ctx, "d1", { name: "x.exe", size_bytes: 10 }, { repo, ...seq }),
    ).toThrow(FileValidationError);
    expect(() =>
      attachFile(ctx, "d1", { name: "big.pdf", size_bytes: MAX_FILE_BYTES + 1 }, { repo, ...seq }),
    ).toThrow(FileValidationError);
  });

  it("딜이 없거나 권한 밖이면 DealNotFoundError", () => {
    const repo = fakeRepo([makeDeal("d1", "o1")]);
    expect(() =>
      attachFile(ctx, "없는딜", { name: "a.pdf", size_bytes: 10 }, { repo, ...seq }),
    ).toThrow(DealNotFoundError);
    // 다른 조직 컨텍스트 → Repo 가 딜을 안 돌려줌(org 격리)
    expect(() =>
      attachFile(ctxOf("o2"), "d1", { name: "a.pdf", size_bytes: 10 }, { repo, ...seq }),
    ).toThrow(DealNotFoundError);
  });
});

describe("listDealFiles / getFile / countDealFiles", () => {
  it("최신순으로 정렬한다", () => {
    const repo = fakeRepo([makeDeal("d1")]);
    attachFile(ctx, "d1", { name: "first.pdf", size_bytes: 10 }, { repo, ...seq });
    attachFile(ctx, "d1", { name: "second.pdf", size_bytes: 10 }, { repo, ...seq });
    expect(listDealFiles(ctx, "d1", { repo }).map((f) => f.name)).toEqual([
      "second.pdf",
      "first.pdf",
    ]);
  });

  it("딜별로 분리된다", () => {
    const repo = fakeRepo([makeDeal("d1"), makeDeal("d2")]);
    attachFile(ctx, "d1", { name: "a.pdf", size_bytes: 10 }, { repo, ...seq });
    expect(countDealFiles(ctx, "d1", { repo })).toBe(1);
    expect(countDealFiles(ctx, "d2", { repo })).toBe(0);
  });

  it("다른 조직에서는 보이지 않는다(org 격리)", () => {
    const repo = fakeRepo([makeDeal("d1", "o1")]);
    attachFile(ctx, "d1", { name: "a.pdf", size_bytes: 10 }, { repo, ...seq });
    expect(listDealFiles(ctxOf("o2"), "d1", { repo })).toEqual([]);
  });

  it("없는 딜은 빈 배열", () => {
    const repo = fakeRepo([]);
    expect(listDealFiles(ctx, "없음", { repo })).toEqual([]);
  });

  it("getFile 은 id 로 찾는다", () => {
    const repo = fakeRepo([makeDeal("d1")]);
    const f = attachFile(ctx, "d1", { name: "a.pdf", size_bytes: 10 }, { repo, ...seq });
    expect(getFile(ctx, "d1", f.id, { repo })?.name).toBe("a.pdf");
    expect(getFile(ctx, "d1", "없음", { repo })).toBeUndefined();
  });
});

describe("removeFile", () => {
  it("첨부를 제거한다", () => {
    const repo = fakeRepo([makeDeal("d1")]);
    const f = attachFile(ctx, "d1", { name: "a.pdf", size_bytes: 10 }, { repo, ...seq });
    expect(removeFile(ctx, "d1", f.id, { repo })).toBe(true);
    expect(listDealFiles(ctx, "d1", { repo })).toEqual([]);
  });

  it("다른 조직은 제거할 수 없다", () => {
    const repo = fakeRepo([makeDeal("d1", "o1")]);
    const f = attachFile(ctx, "d1", { name: "a.pdf", size_bytes: 10 }, { repo, ...seq });
    expect(removeFile(ctxOf("o2"), "d1", f.id, { repo })).toBe(false);
    expect(listDealFiles(ctx, "d1", { repo })).toHaveLength(1);
  });

  it("없는 파일/딜 제거는 false", () => {
    const repo = fakeRepo([makeDeal("d1")]);
    expect(removeFile(ctx, "d1", "없음", { repo })).toBe(false);
    expect(removeFile(ctx, "없는딜", "x", { repo })).toBe(false);
  });
});
