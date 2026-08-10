// 채팅 첨부 규칙 테스트 — MWC 실행 결과 13/13 PASS (node --test)
// 프로젝트 러너(vitest 등)에 맞춰 코덱스가 옮길 것.

import assert from "node:assert/strict";
import { test } from "vitest";
import {
  checkAttachment,
  formatBytes,
  kindOf,
  partitionAttachments,
  pastedFileName,
} from "./attachment-rules.ts";

const MB = 1024 * 1024;

test("이미지 통과", () => {
  const r = checkAttachment({ type: "image/png", size: 400 * 1024 });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.kind, "image");
});

test("영상 통과", () => {
  const r = checkAttachment({ type: "video/mp4", size: 8 * MB });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.kind, "video");
});

test("MOV(quicktime) 허용 — 아이폰 촬영본", () => {
  assert.equal(kindOf("video/quicktime"), "video");
});

// ★ 보안 회귀 방지
test("SVG 거부 — 스크립트 삽입 벡터", () => {
  const r = checkAttachment({ type: "image/svg+xml", size: 1024 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "type");
});

test("실행파일 거부", () => {
  assert.equal(checkAttachment({ type: "application/x-msdownload", size: 1024 }).ok, false);
});

test("이미지 10MB 초과 거부 — 문구에 실제 크기가 보인다", () => {
  const r = checkAttachment({ type: "image/jpeg", size: 12 * MB });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "size");
    assert.ok(r.reason.includes("12.0MB"));
    assert.ok(r.reason.includes("사진"));
  }
});

test("영상 50MB 초과 거부", () => {
  const r = checkAttachment({ type: "video/mp4", size: 60 * MB });
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.reason.includes("영상"));
});

test("빈 파일 거부", () => {
  const r = checkAttachment({ type: "image/png", size: 0 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "empty");
});

test("한 메시지 5개 상한", () => {
  const r = checkAttachment({ type: "image/png", size: 1024 }, 5);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "count");
});

// ★ "조용히 버리지 않는다" 계약
test("partition — 통과·거절을 함께 돌려준다", () => {
  const { accepted, rejected } = partitionAttachments([
    { type: "image/png", size: 1024, name: "a.png" },
    { type: "image/svg+xml", size: 1024, name: "b.svg" },
    { type: "video/mp4", size: 9 * MB, name: "c.mp4" },
  ]);
  assert.equal(accepted.length, 2);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].file.name, "b.svg");
});

test("partition — 이미 담긴 개수를 누적 반영", () => {
  const files = Array.from({ length: 7 }, (_, i) => ({
    type: "image/png",
    size: 1024,
    name: `${i}.png`,
  }));
  const { accepted, rejected } = partitionAttachments(files, 0);
  assert.equal(accepted.length, 5);
  assert.equal(rejected.length, 2);
});

test("붙여넣기 파일명 — 시각 기반 + 확장자 정규화", () => {
  const at = new Date(2026, 6, 27, 21, 5, 9);
  assert.equal(pastedFileName("image/png", at), "붙여넣기_20260727_210509.png");
  assert.equal(pastedFileName("image/jpeg", at), "붙여넣기_20260727_210509.jpg");
  assert.equal(pastedFileName("video/quicktime", at), "붙여넣기_20260727_210509.mov");
});

test("formatBytes", () => {
  assert.equal(formatBytes(512), "512B");
  assert.equal(formatBytes(2048), "2KB");
  assert.equal(formatBytes(3 * MB), "3.0MB");
});
