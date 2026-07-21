import { describe, it, expect, beforeEach } from "vitest";
import type { Ctx } from "@/lib/types";
import {
  __resetFiles,
  attachFile,
  buildStoragePath,
  countDealFiles,
  extensionOf,
  FileValidationError,
  formatBytes,
  getFile,
  listDealFiles,
  MAX_FILE_BYTES,
  removeFile,
  sanitizeFileName,
  validateUpload,
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

beforeEach(() => {
  __resetFiles();
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
    expect(extensionOf(".gitignore")).toBeNull(); // 선행 점만 있는 건 확장자 아님
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
      const r = validateUpload({ name: bad, size_bytes: 10 });
      expect(r.ok).toBe(false);
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

// ── 저장 경로 ────────────────────────────────────────────

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

// ── 크기 표기 ────────────────────────────────────────────

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

// ── 첨부/조회/삭제 ───────────────────────────────────────

describe("attachFile / listDealFiles", () => {
  it("딜에 첨부하고 목록에서 조회된다", () => {
    const f = attachFile(ctx, "deal-1", { name: "계약서.pdf", size_bytes: 100 });
    expect(f.deal_id).toBe("deal-1");
    expect(f.org_id).toBe("o1");
    expect(f.uploaded_by).toBe("u1");
    expect(listDealFiles(ctx, "deal-1")).toHaveLength(1);
  });

  it("파일명을 정규화해 저장한다", () => {
    const f = attachFile(ctx, "d", { name: "../../evil.pdf", size_bytes: 10 });
    expect(f.name).toBe("evil.pdf");
  });

  it("검증 실패 시 FileValidationError 를 던진다", () => {
    expect(() => attachFile(ctx, "d", { name: "x.exe", size_bytes: 10 })).toThrow(
      FileValidationError,
    );
    expect(() => attachFile(ctx, "d", { name: "big.pdf", size_bytes: MAX_FILE_BYTES + 1 })).toThrow(
      FileValidationError,
    );
  });

  it("다른 딜의 파일은 섞이지 않는다", () => {
    attachFile(ctx, "deal-1", { name: "a.pdf", size_bytes: 10 });
    attachFile(ctx, "deal-2", { name: "b.pdf", size_bytes: 10 });
    expect(listDealFiles(ctx, "deal-1").map((f) => f.name)).toEqual(["a.pdf"]);
    expect(countDealFiles(ctx, "deal-2")).toBe(1);
  });

  it("다른 조직의 파일은 보이지 않는다(org 격리)", () => {
    attachFile(ctxOf("o1"), "deal-1", { name: "our.pdf", size_bytes: 10 });
    attachFile(ctxOf("o2"), "deal-1", { name: "their.pdf", size_bytes: 10 });
    expect(listDealFiles(ctxOf("o1"), "deal-1").map((f) => f.name)).toEqual(["our.pdf"]);
    expect(listDealFiles(ctxOf("o2"), "deal-1").map((f) => f.name)).toEqual(["their.pdf"]);
  });

  it("최신순으로 정렬한다", () => {
    let t = 0;
    const now = () => `2026-07-21T00:00:0${t++}.000Z`;
    attachFile(ctx, "d", { name: "first.pdf", size_bytes: 10 }, now);
    attachFile(ctx, "d", { name: "second.pdf", size_bytes: 10 }, now);
    expect(listDealFiles(ctx, "d").map((f) => f.name)).toEqual(["second.pdf", "first.pdf"]);
  });
});

describe("getFile / removeFile", () => {
  it("org 스코프 안에서만 조회된다", () => {
    const f = attachFile(ctxOf("o1"), "d", { name: "a.pdf", size_bytes: 10 });
    expect(getFile(ctxOf("o1"), f.id)?.name).toBe("a.pdf");
    expect(getFile(ctxOf("o2"), f.id)).toBeUndefined();
  });

  it("삭제하면 목록에서 사라진다", () => {
    const f = attachFile(ctx, "d", { name: "a.pdf", size_bytes: 10 });
    expect(removeFile(ctx, f.id)).toBe(true);
    expect(listDealFiles(ctx, "d")).toHaveLength(0);
  });

  it("다른 조직은 삭제할 수 없다", () => {
    const f = attachFile(ctxOf("o1"), "d", { name: "a.pdf", size_bytes: 10 });
    expect(removeFile(ctxOf("o2"), f.id)).toBe(false);
    expect(listDealFiles(ctxOf("o1"), "d")).toHaveLength(1);
  });

  it("없는 파일 삭제는 false", () => {
    expect(removeFile(ctx, "없음")).toBe(false);
  });
});
