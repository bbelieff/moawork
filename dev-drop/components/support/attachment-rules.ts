// 채팅 첨부 규칙 — 순수 함수(서버·클라이언트 공용)
//
// 고객과 운영자 **양쪽 모두** 사진·영상을 올릴 수 있다.
// 이 파일은 "무엇을 받아줄지"를 한 곳에서 정한다. 클라이언트 검증만으로는 못 막으므로
// 서버(업로드 API)에서도 **같은 함수**를 호출해야 한다.
//
// 보안 메모:
//  · 확장자·MIME 은 위조된다. 서버는 반드시 **매직넘버**로 실제 형식을 다시 확인한다.
//  · 이미지는 저장 전 **EXIF 제거**(GPS 좌표가 들어 있을 수 있다 — 고객사 위치 유출).
//  · SVG 는 받지 않는다(스크립트 삽입 벡터). 필요하면 PNG 로 변환해 올리게 안내.
//
// 작성: MWC(코워크).

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_FILES_PER_MESSAGE = 5;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export type AttachmentKind = "image" | "video";

export type AttachmentReject = {
  ok: false;
  /** 사용자에게 그대로 보여줄 문장(개발자 용어 금지) */
  reason: string;
  code: "type" | "size" | "count" | "empty";
};

export type AttachmentAccept = {
  ok: true;
  kind: AttachmentKind;
};

export type AttachmentCheck = AttachmentAccept | AttachmentReject;

export function kindOf(mime: string): AttachmentKind | null {
  if ((IMAGE_TYPES as readonly string[]).includes(mime)) return "image";
  if ((VIDEO_TYPES as readonly string[]).includes(mime)) return "video";
  return null;
}

export function maxBytesFor(kind: AttachmentKind): number {
  return kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
}

/** 사람이 읽는 크기 — 오류 문구에 쓴다. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 파일 1개 검사.
 * @param alreadyAttached 이미 담긴 개수(개수 상한 검사용)
 */
export function checkAttachment(
  file: { type: string; size: number },
  alreadyAttached = 0,
): AttachmentCheck {
  if (alreadyAttached >= MAX_FILES_PER_MESSAGE) {
    return {
      ok: false,
      code: "count",
      reason: `한 번에 ${MAX_FILES_PER_MESSAGE}개까지 보낼 수 있어요.`,
    };
  }

  if (file.size <= 0) {
    return { ok: false, code: "empty", reason: "빈 파일은 보낼 수 없어요." };
  }

  const kind = kindOf(file.type);
  if (!kind) {
    return {
      ok: false,
      code: "type",
      reason: "사진(PNG·JPG·WebP·GIF)과 영상(MP4·WebM·MOV)만 보낼 수 있어요.",
    };
  }

  const limit = maxBytesFor(kind);
  if (file.size > limit) {
    const what = kind === "image" ? "사진" : "영상";
    return {
      ok: false,
      code: "size",
      reason: `${what}은 ${formatBytes(limit)}까지 보낼 수 있어요. (지금 ${formatBytes(file.size)})`,
    };
  }

  return { ok: true, kind };
}

/**
 * 붙여넣기·드롭·선택으로 들어온 목록을 한 번에 거른다.
 * 통과분과 거절 사유를 함께 돌려준다 — 조용히 버리지 않기 위함.
 */
export function partitionAttachments<T extends { type: string; size: number; name?: string }>(
  files: readonly T[],
  alreadyAttached = 0,
): { accepted: Array<{ file: T; kind: AttachmentKind }>; rejected: Array<{ file: T; reason: string }> } {
  const accepted: Array<{ file: T; kind: AttachmentKind }> = [];
  const rejected: Array<{ file: T; reason: string }> = [];

  for (const file of files) {
    const result = checkAttachment(file, alreadyAttached + accepted.length);
    if (result.ok) accepted.push({ file, kind: result.kind });
    else rejected.push({ file, reason: result.reason });
  }

  return { accepted, rejected };
}

/**
 * 클립보드 이미지는 이름이 없거나 "image.png" 로 뭉개진다.
 * 대화에서 구분되도록 시각 기반 이름을 만든다.
 */
export function pastedFileName(mime: string, at: Date = new Date()): string {
  const ext = mime.split("/")[1]?.replace("quicktime", "mov").replace("jpeg", "jpg") ?? "bin";
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `붙여넣기_${stamp}.${ext}`;
}
