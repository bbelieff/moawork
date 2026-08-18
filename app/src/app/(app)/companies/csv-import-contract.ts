/**
 * 고객사 CSV 가져오기 결과 계약.
 *
 * ★ actions.ts 가 "use server" 라 상수·타입을 거기서 export 할 수 없다(BBE-217).
 *   그래서 «순수 모듈» 인 이 파일에 둔다.
 */

export type CompanyImportRejection = Readonly<{
  line: number;
  title: string;
  reason: string;
}>;

export type CompanyImportResult = Readonly<{
  ok: boolean;
  message: string;
  imported: number;
  rejected: readonly CompanyImportRejection[];
  /** 같은 요청을 다시 보낸 경우. «실패» 가 아니라 «이미 됐다» 이다. */
  duplicate?: boolean;
}>;
