import { describe, expect, it } from "vitest";
import { normalizeDate, parseCertificateText } from "./parse-certificate";

/**
 * 합성 픽스처 일괄 고지: 아래 이름·번호·주소는 전부 가짜다.
 * (주)가상상회 / 홍길동(한국 관용 가명) / 123-45-67891(순차숫자 체크섬용).
 * 문자열 테스트 통과가 실물 인식 정확도를 뜻하지 않는다.
 */
const CERT = [
  "사 업 자 등 록 증",
  "등록번호 : 123-45-67891",
  "상호 : (주)가상상회",
  "성명(대표자) : 홍길동",
  "개업연월일 : 2020년 3월 2일",
  "사업장 소재지 : 서울특별시 가상구 예시로 123",
  "업태 : 도매 및 소매업",
  "종목 : 전자상거래",
  "일반과세자",
].join("\n");

describe("parse-certificate", () => {
  it("기본 증명서에서 9개 필드를 뽑는다", () => {
    const r = parseCertificateText(CERT);
    expect(r.fields.bizNo.value).toBe("123-45-67891");
    expect(r.fields.bizNo.valid).toBe(true);
    expect(r.fields.companyName.value).toContain("가상상회");
    expect(r.fields.representative.value).toBe("홍길동");
    expect(r.fields.openedOn.value).toBe("2020-03-02");
    expect(r.fields.businessAddress.value).toContain("가상구");
    expect(r.fields.businessCategory.value).toContain("도매");
    expect(r.fields.businessItem.value).toContain("전자상거래");
    expect(r.fields.taxation.value).toBe("일반과세자");
    expect(r.fields.legalForm.value).toBe("주식회사");
  });

  it("라벨 다음 줄 값(멀티라인)을 읽고 표시한다", () => {
    const r = parseCertificateText("상호\n(주)가상상회\n대표자\n홍길동");
    expect(r.fields.companyName.value).toContain("가상상회");
    expect(
      r.fields.companyName.warnings.some((w) => w.includes("다음 줄")),
    ).toBe(true);
    expect(r.fields.representative.value).toBe("홍길동");
  });

  it("반복 라벨은 첫 값을 쓰고 경고를 남긴다", () => {
    const r = parseCertificateText("상호 : 첫째상회\n중간 노이즈\n상호 : 둘째상회");
    expect(r.fields.companyName.value).toContain("첫째상회");
    expect(
      r.fields.companyName.warnings.some((w) => w.includes("2번")),
    ).toBe(true);
  });

  it("공백 노이즈 낀 라벨을 찾는다", () => {
    const r = parseCertificateText("등 록 번 호 123-45-67891");
    expect(r.fields.bizNo.value).toBe("123-45-67891");
  });

  it("날짜 표기 변형을 정규화한다", () => {
    expect(normalizeDate("2021년 12월 31일")).toBe("2021-12-31");
    expect(normalizeDate("2021-1-5")).toBe("2021-01-05");
    expect(normalizeDate("2021. 02. 03")).toBe("2021-02-03");
    expect(normalizeDate("2021/2/3")).toBe("2021-02-03");
    expect(normalizeDate("월말")).toBeNull();
    expect(normalizeDate("2021년 13월 1일")).toBeNull();
  });

  it("체크섬 불일치 번호는 valid:false·저신뢰로 제안한다", () => {
    const r = parseCertificateText("등록번호 : 123-45-67890");
    expect(r.fields.bizNo.value).not.toBe("");
    expect(r.fields.bizNo.valid).toBe(false);
    expect(r.fields.bizNo.confidence).toBeLessThan(0.5);
    expect(
      r.fields.bizNo.warnings.some((w) => w.includes("체크섬")),
    ).toBe(true);
  });

  it("주민등록번호가 있어도 생년월일을 추론하지 않는다", () => {
    const r = parseCertificateText(
      "상호 : (주)가상상회\n주민등록번호 : 900101-1234567\n대표자 : 홍길동",
    );
    expect(r.fields.birthdate.value).toBe("");
    expect(r.documentWarnings.some((w) => w.includes("주민등록번호"))).toBe(true);
  });

  it("명시된 생년월일만 추출한다", () => {
    const r = parseCertificateText("대표자 : 홍길동\n생년월일 : 1990년 1월 1일");
    expect(r.fields.birthdate.value).toBe("1990-01-01");
  });

  it("과세 유형이 여러 개면 첫 후보+경고, 없으면 blank", () => {
    const multi = parseCertificateText("일반과세자 간이과세자");
    expect(multi.fields.taxation.value).toBe("일반과세자");
    expect(multi.fields.taxation.warnings.length).toBeGreaterThan(0);
    const none = parseCertificateText("상호 : (주)가상상회");
    expect(none.fields.taxation.value).toBe("");
  });

  it("법인 형태는 과세 유형과 분리된 참고 필드다", () => {
    const r = parseCertificateText(CERT);
    expect(r.fields.legalForm.value).toBe("주식회사");
    expect(r.fields.taxation.value).toBe("일반과세자");
    expect(r.fields.taxation.value).not.toContain("주식");
  });

  it("빈 입력은 전부 blank + 문서 경고를 남긴다", () => {
    const r = parseCertificateText("   \n  ");
    expect(Object.values(r.fields).every((f) => f.value === "")).toBe(true);
    expect(r.documentWarnings.length).toBeGreaterThan(0);
  });
});
