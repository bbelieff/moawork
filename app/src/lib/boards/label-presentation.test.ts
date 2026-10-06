import { describe, expect, it } from "vitest";
import { labelSearchText, presentLabel, presentLabels } from "./label-presentation";

describe("presentLabel — 표시 전용 앞머리 이모지 정리", () => {
  it("먼데이 단계·그룹명의 앞머리 그림 문자를 걷는다", () => {
    expect(presentLabel("📂소진공 혁신성장 대기")).toBe("소진공 혁신성장 대기");
    expect(presentLabel("⏹️ 준비단계")).toBe("준비단계"); // VS16 포함
    expect(presentLabel("▶️ 진행중")).toBe("진행중");
    expect(presentLabel("🔂 심사 중")).toBe("심사 중");
    expect(presentLabel("💰 승인")).toBe("승인");
    expect(presentLabel("⛔ 대출불가")).toBe("대출불가");
    expect(presentLabel("📂 소진공 재도전 접수예정")).toBe("소진공 재도전 접수예정");
  });

  it("ZWJ 결합·피부색·연속 이모지도 한 덩어리로 걷는다", () => {
    expect(presentLabel("👩‍💻 개발 지원")).toBe("개발 지원");
    expect(presentLabel("👍🏽 확정")).toBe("확정");
    expect(presentLabel("🔥⭐ 우선")).toBe("우선");
  });

  it("글자·숫자로 시작하거나 중간의 이모지는 그대로 둔다", () => {
    expect(presentLabel("1차 부재")).toBe("1차 부재");
    expect(presentLabel("소공인(상생)")).toBe("소공인(상생)");
    expect(presentLabel("관리중 📂")).toBe("관리중 📂");
    expect(presentLabel("")).toBe("");
  });

  it("이모지뿐인 라벨은 원문을 보여 준다", () => {
    expect(presentLabel("📂")).toBe("📂");
    expect(presentLabel("⏹️ ")).toBe("⏹️ ");
  });

  it("이모지만 다른 라벨끼리는 원문을 지켜 구별되게 한다", () => {
    expect(presentLabels(["준비단계", "⏹️ 준비단계", "▶️ 진행중", "⏹️ 준비단계"])).toEqual([
      "준비단계",
      "⏹️ 준비단계",
      "진행중",
      "⏹️ 준비단계",
    ]);
    expect(presentLabels(["📂소진공 혁신성장 대기", "대기중"])).toEqual(["소진공 혁신성장 대기", "대기중"]);
  });

  it("검색 문자열은 원문과 표시 라벨을 함께 담는다", () => {
    expect(labelSearchText("📂소진공 혁신성장 대기")).toContain("📂소진공");
    expect(labelSearchText("📂소진공 혁신성장 대기")).toContain(" 소진공 혁신성장 대기");
    expect(labelSearchText("대기중")).toBe("대기중");
  });
});
