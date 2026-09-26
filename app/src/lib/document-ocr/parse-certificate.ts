/**
 * document-ocr/parse-certificate — 국문 사업자등록증 OCR 텍스트 → 필드 제안.
 *
 * OCR은 틀리기 쉬우므로 이 파서는 "제안"만 만든다:
 * - 못 찾은 필드는 "" 로 둔다 (호출자가 양호한 기존값을 blank로 덮지 않는다).
 * - 생년월일은 "생년월일" 명시 라벨이 있을 때만 추출한다.
 *   주민등록번호 앞자리 등에서의 추론은 절대 하지 않으며, 주민번호가
 *   보이면 문서 경고에 "무시"를 남긴다.
 * - 법인 형태(주식회사 등)는 과세 유형과 분리된 참고 필드다.
 * - 이 파서는 사업자등록증만 다룬다. 다른 증빙(부가세과세표준증명원 등)은
 *   별개 문서라 여기서 다루지 않는다.
 */

import { findBizNoCandidates, formatBizNo, isValidBizNo, normalizeBizNo } from "./bizno";
import {
  TAXATION_LABEL,
  type OcrFieldKey,
  type OcrParseResult,
  type OcrProposedField,
  type TaxationValue,
} from "./types";

const TAXATION_PHRASE: Record<TaxationValue, string> = {
  general: "일반과세자",
  simplified: "간이과세자",
  exempt: "면세사업자",
};

const LEGAL_FORMS = [
  "주식회사",
  "유한회사",
  "유한책임회사",
  "합자회사",
  "합명회사",
] as const;

function fullWidthToHalf(raw: string): string {
  return raw.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );
}

function normalize(raw: string): string {
  return fullWidthToHalf(raw || "")
    .replace(/[‐‑‒–—―─ㅡ]/g, "-")
    .replace(/：/g, ":")
    .replace(/．/g, ".")
    .replace(/\u00a0/g, " ");
}

/** "사업자등록번호" → /사\s*업\s*자\s*…/ — OCR 공백 노이즈에 둔감한 라벨식. */
function labelPattern(label: string): RegExp {
  const chars = [...label].map((ch) =>
    ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(chars.join("\\s*"));
}

const LEAD_SEP = /^[\s:：\-–—·•|/()［\[\]\"'“”]+/;
const TRAIL_SEP = /[\s:：\-–—·•|/()］\[\]\"'“”]+$/;

function stripSep(raw: string): string {
  return raw.replace(LEAD_SEP, "").replace(TRAIL_SEP, "").trim();
}

type LineHit = { line: string; index: number };

function findLabelLines(lines: string[], labels: string[]): LineHit[] {
  const patterns = labels.map(labelPattern);
  const hits: LineHit[] = [];
  lines.forEach((line, index) => {
    if (patterns.some((re) => re.test(line))) hits.push({ line, index });
  });
  return hits;
}

/** 같은 줄 라벨 뒤 값, 없으면 다음 비어 있지 않은 줄 (멀티라인). */
function valueAfter(
  lines: string[],
  hit: LineHit,
  labels: string[],
): { value: string; multiline: boolean } {
  let rest = hit.line;
  for (const label of labels) {
    rest = rest.replace(labelPattern(label), " ");
  }
  const same = stripSep(rest.split(/업태|종목|대표자|성명|소재지|개업|생년월일|등록번호|상호|법인명|과세/g)[0] ?? "");
  if (same) return { value: same, multiline: false };
  for (let i = hit.index + 1; i < Math.min(hit.index + 3, lines.length); i += 1) {
    const next = stripSep(lines[i]);
    if (next) return { value: next, multiline: true };
  }
  return { value: "", multiline: false };
}

function blank(key: OcrFieldKey): OcrProposedField {
  return { key, value: "", confidence: 0, warnings: [] };
}

/** YYYY년 M월 D일 / YYYY-MM-DD / YYYY.MM.DD / YYYYMMDD(라벨 맥락) → YYYY-MM-DD. */
export function normalizeDate(raw: string): string | null {
  const t = normalize(raw).replace(/\s+/g, "");
  let m =
    t.match(/(\d{4})년(\d{1,2})월(\d{1,2})일/) ||
    t.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) {
    const compact = t.match(/(\d{4})(\d{2})(\d{2})/);
    if (compact && /^19|20/.test(compact[1])) m = compact;
    else return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function firstDateIn(raw: string): string | null {
  const t = normalize(raw);
  const cands =
    t.match(/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/g) ||
    t.match(/\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/g) ||
    [];
  for (const c of cands) {
    const n = normalizeDate(c);
    if (n) return n;
  }
  return null;
}

function parseTaxation(text: string): {
  value: string;
  confidence: number;
  warnings: string[];
  evidence?: string;
} {
  const found: TaxationValue[] = (Object.keys(TAXATION_PHRASE) as TaxationValue[]).filter(
    (k) => text.includes(TAXATION_PHRASE[k]),
  );
  if (found.length === 0) return { value: "", confidence: 0, warnings: [] };
  if (found.length === 1) {
    return {
      value: TAXATION_LABEL[found[0]],
      confidence: 0.6,
      warnings: [],
      evidence: TAXATION_PHRASE[found[0]],
    };
  }
  return {
    value: TAXATION_LABEL[found[0]],
    confidence: 0.35,
    warnings: [
      `과세 유형 표기가 ${found.length}개 보입니다. 첫 후보를 제안하며 확인이 필요합니다.`,
    ],
    evidence: found.map((k) => TAXATION_PHRASE[k]).join(" / "),
  };
}

function parseLegalForm(companyName: string, text: string): OcrProposedField {
  const scope = companyName || text;
  const hit = LEGAL_FORMS.find((form) => scope.includes(form));
  if (hit) {
    return {
      key: "legalForm",
      value: hit,
      confidence: companyName ? 0.7 : 0.4,
      warnings: ["법인 형태는 과세 유형과 다른 참고 정보입니다."],
      evidence: companyName ? undefined : hit,
    };
  }
  // "(주)"/"㈜" 약어 → 주식회사. OCR 괄호 노이즈("주)가상상회")에 둔감하게
  // 괄호를 지운 뒤 단어 경계로 판정한다 ("제주상회" 같은 오탐 방지).
  const deParen = scope.replace(/[()［\[\]\"'“”]/g, " ");
  const abbreviated =
    /(^|[^\p{L}\p{N}])주($|[^\p{L}\p{N}])/u.test(deParen) || deParen.includes("㈜");
  if (!abbreviated) return blank("legalForm");
  return {
    key: "legalForm",
    value: "주식회사",
    confidence: companyName ? 0.7 : 0.4,
    warnings: ["법인 형태는 과세 유형과 다른 참고 정보입니다."],
    evidence: companyName ? undefined : "(주)",
  };
}

export function parseCertificateText(rawText: string): OcrParseResult {
  const text = normalize(rawText);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const documentWarnings: string[] = [];
  const fields: Record<OcrFieldKey, OcrProposedField> = {
    taxation: blank("taxation"),
    companyName: blank("companyName"),
    representative: blank("representative"),
    birthdate: blank("birthdate"),
    openedOn: blank("openedOn"),
    businessAddress: blank("businessAddress"),
    businessCategory: blank("businessCategory"),
    businessItem: blank("businessItem"),
    bizNo: blank("bizNo"),
    legalForm: blank("legalForm"),
  };

  if (!text.trim()) {
    documentWarnings.push("읽힌 글자가 없습니다. 더 선명한 원본으로 다시 시도하세요.");
    return { fields, documentWarnings, sourceChars: 0, sourceKind: "ocr" };
  }

  const take = (
    key: OcrFieldKey,
    labels: string[],
    refine: (raw: string, evidence: string) => Partial<OcrProposedField> & { value: string },
  ) => {
    const hits = findLabelLines(lines, labels);
    if (hits.length === 0) return;
    const { value: rawValue, multiline } = valueAfter(lines, hits[0], labels);
    if (!rawValue) return;
    const evidence = hits[0].line.slice(0, 80);
    const warnings: string[] = [];
    if (hits.length > 1) {
      warnings.push(`"${labels[0]}" 표기가 ${hits.length}번 나옵니다. 첫 값을 제안합니다.`);
    }
    if (multiline) warnings.push("라벨 다음 줄에서 값을 읽었습니다. 확인해 주세요.");
    const refined = refine(rawValue, evidence);
    fields[key] = {
      key,
      value: refined.value,
      confidence: refined.confidence ?? (multiline ? 0.7 : 0.85),
      warnings: [...warnings, ...(refined.warnings ?? [])],
      evidence: refined.evidence ?? evidence,
      valid: refined.valid,
    };
  };

  // 상호(법인명)
  take("companyName", ["상호", "법인명"], (raw) => {
    const cleaned = stripSep(raw).slice(0, 60);
    return {
      value: cleaned,
      confidence: cleaned ? 0.8 : 0,
      warnings: cleaned ? [] : ["상호를 읽지 못했습니다."],
    };
  });

  // 대표자 성명
  take("representative", ["대표자", "성명"], (raw) => {
    const m = stripSep(raw).match(/[가-힣]{2,5}/);
    const value = m ? m[0] : stripSep(raw).slice(0, 20);
    return { value, warnings: m ? [] : ["성명 형식이 흐릿합니다. 직접 확인해 주세요."] };
  });

  // 생년월일 — 명시 라벨만. 주민번호 추론 금지.
  take("birthdate", ["생년월일"], (raw) => {
    const date = firstDateIn(raw);
    if (!date) {
      return {
        value: stripSep(raw).slice(0, 20),
        confidence: 0.3,
        warnings: ["생년월일 형식이 흐릿합니다. 주민등록번호로 추측하지 않았습니다."],
      };
    }
    return { value: date, confidence: 0.8 };
  });
  if (/주민\s*등\s*록\s*번\s*호|주민등록번호/.test(text)) {
    documentWarnings.push(
      "주민등록번호로 보이는 표기는 무시했습니다. 생년월일은 명시된 경우에만 제안합니다.",
    );
  }

  // 개업연월일
  take("openedOn", ["개업연월일", "개업일", "개업 연월일"], (raw) => {
    const date = firstDateIn(raw);
    if (!date) {
      return {
        value: stripSep(raw).slice(0, 20),
        confidence: 0.3,
        warnings: ["개업일 형식이 흐릿합니다. 확인해 주세요."],
      };
    }
    return { value: date, confidence: 0.8 };
  });

  // 사업장 소재지
  take("businessAddress", ["사업장 소재지", "사업장소재지", "소재지"], (raw) => {
    const value = stripSep(raw).slice(0, 120);
    return { value, confidence: value.length >= 5 ? 0.75 : 0.45 };
  });

  // 업태 / 종목
  take("businessCategory", ["업태"], (raw) => ({
    value: stripSep(raw).slice(0, 60),
  }));
  take("businessItem", ["종목"], (raw) => ({
    value: stripSep(raw).slice(0, 60),
  }));

  // 사업자등록번호 — 체크섬 검증 포함
  const bizHits = findLabelLines(lines, ["사업자등록번호", "등록번호", "등록 번호"]);
  const ordered: string[] = [];
  if (bizHits.length > 0) {
    for (const hit of bizHits) {
      const { value: rawValue } = valueAfter(lines, hit, [
        "사업자등록번호",
        "등록번호",
        "등록 번호",
      ]);
      findBizNoCandidates(rawValue).forEach((c) => {
        if (!ordered.includes(c)) ordered.push(c);
      });
    }
  }
  if (ordered.length === 0) {
    findBizNoCandidates(text).forEach((c) => {
      if (!ordered.includes(c)) ordered.push(c);
    });
  }
  if (ordered.length > 0) {
    const raw = ordered[0];
    const digits = normalizeBizNo(raw);
    const ok = isValidBizNo(raw);
    const warnings: string[] = [];
    if (bizHits.length > 1) {
      warnings.push(`"등록번호" 표기가 ${bizHits.length}번 나옵니다. 첫 값을 제안합니다.`);
    }
    if (ordered.length > 1) warnings.push("번호 후보가 여러 개입니다. 첫 후보를 제안합니다.");
    if (!ok) warnings.push("체크섬이 맞지 않습니다. 숫자를 직접 확인해 주세요.");
    fields.bizNo = {
      key: "bizNo",
      value: ok ? formatBizNo(digits) : stripSep(raw).slice(0, 20),
      confidence: ok ? 0.9 : 0.3,
      warnings,
      evidence: (bizHits[0]?.line ?? raw).slice(0, 80),
      valid: ok,
    };
  }

  // 과세 유형
  const tax = parseTaxation(text);
  if (tax.value) {
    fields.taxation = { key: "taxation", ...tax };
  }

  // 법인 형태 (참고)
  fields.legalForm = parseLegalForm(fields.companyName.value, text);

  return { fields, documentWarnings, sourceChars: text.length, sourceKind: "ocr" };
}
