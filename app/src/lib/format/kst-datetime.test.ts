import { describe, expect, it } from "vitest";
import { kstDateTimeLocal, kstDateTimeText, kstToday, parseKstDateTime } from "./kst-datetime";

describe("한국 시각 일시 (QA #886)", () => {
  it("저장된 순간을 한국 시각 입력칸 값으로 보인다", () => {
    expect(kstDateTimeLocal("2026-10-11T05:00:00.000Z")).toBe("2026-10-11T14:00");
    expect(kstDateTimeLocal("2026-10-11T20:30:00.000Z")).toBe("2026-10-12T05:30");
    expect(kstDateTimeText("2026-10-11T05:00:00.000Z")).toBe("2026-10-11 14:00");
    expect(kstDateTimeLocal("읽을 수 없음 값")).toBe("읽을 수 없음 값".slice(0, 16));
  });

  it("시간대 없는 입력은 한국 시각으로, 시간대가 있으면 그대로 읽는다", () => {
    expect(parseKstDateTime("2026-10-11T14:00")?.toISOString()).toBe("2026-10-11T05:00:00.000Z");
    expect(parseKstDateTime("2026-10-11T14:00:30")?.toISOString()).toBe("2026-10-11T05:00:30.000Z");
    expect(parseKstDateTime("2026-10-11T05:00:00.000Z")?.toISOString()).toBe("2026-10-11T05:00:00.000Z");
    expect(parseKstDateTime("2026-10-11T14:00+09:00")?.toISOString()).toBe("2026-10-11T05:00:00.000Z");
    expect(parseKstDateTime("아님")).toBeNull();
  });

  it("입력칸 값으로 보였다가 다시 저장해도 같은 순간이다", () => {
    const saved = "2026-03-01T15:10:00.000Z";
    expect(parseKstDateTime(kstDateTimeLocal(saved))?.toISOString()).toBe(saved);
  });

  it("오늘 날짜는 한국 기준이다 — 한국 오전 9시 전에도 어제가 아니다", () => {
    expect(kstToday(new Date("2026-10-31T23:30:00.000Z"))).toBe("2026-11-01");
    expect(kstToday(new Date("2026-11-01T14:59:00.000Z"))).toBe("2026-11-01");
  });
});
