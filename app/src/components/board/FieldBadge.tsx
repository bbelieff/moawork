/**
 * 컬럼 헤더의 출처 배지 — BBE-123 · D09.
 *
 * 타입은 배지로 따로 그리지 않는다(목업 정본과 동일 — 타입·출처 조합은 셀 `title` 툴팁으로
 * 노출한다). 여기서는 "편집 가능 여부"를 정하는 **출처**만 한눈에 보이면 된다.
 *
 * 색은 새 hex 를 만들지 않고 기존 --mw-* 토큰만 쓴다 — lk(연동)=automation,
 * calc(수식)=primary(보라), 나머지 4종은 전용 색이 없어 중립 톤을 공유한다.
 */
import { getFieldSourceSpec, type FieldSource, type FieldSourceSpec } from "@/lib/field/source";

const TONE_CLASS: Record<FieldSourceSpec["tone"], string> = {
  neutral: "text-mw-sub",
  automation: "bg-mw-tint-teal text-mw-automation",
  primary: "text-mw-primary",
  // ✉ 발송만 테두리까지 준다 — BBE-148. 나머지 배지는 글자색만이라, 테두리 하나로
  // 「이 칸은 성격이 다르다」가 스캔 한 번에 잡힌다.
  danger: "bg-mw-tint-coral text-mw-error ring-1 ring-mw-error/40 font-semibold",
};

export function SourceBadge({ source }: { source: FieldSource }) {
  const spec = getFieldSourceSpec(source);
  return (
    <span
      aria-hidden="true"
      title={`${spec.label} — ${spec.description}`}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[0.6rem] leading-none ${TONE_CLASS[spec.tone]}`}
    >
      {spec.mark}
    </span>
  );
}
