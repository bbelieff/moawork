/**
 * document-ocr — public barrel. SSR 안전: ocr-client는 dynamic import 전용이며
 * 이 배럴에서 tesseract.js / pdfjs-dist를 정적으로 import하지 않는다.
 */
export * from "./types";
export * from "./limits";
export * from "./bizno";
export * from "./parse-certificate";
export * from "./apply-adapter";
export type { OcrEngineText } from "./ocr-client";
