import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OCR_LIMITS } from "./limits";
import { buildOcrAssetUrls } from "./ocr-client";

const VALID_MANIFEST = {
  package: "document-ocr-assets v1",
  tesseractJs: "7.0.0",
  pdfjs: "6.3.289",
  worker: "worker.min.js",
  core: ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm"],
  langs: ["kor", "eng"],
  gzip: true,
};

describe("buildOcrAssetUrls", () => {
  it("정상 manifest는 전부 same-origin 경로로 푼다", () => {
    const urls = buildOcrAssetUrls({ ...VALID_MANIFEST });
    expect(urls.workerPath).toBe(`${OCR_LIMITS.assetBasePath}/worker.min.js`);
    expect(urls.corePath).toBe(
      `${OCR_LIMITS.assetBasePath}/tesseract/tesseract-core-simd-lstm.wasm.js`,
    );
    expect(urls.langPath).toBe(`${OCR_LIMITS.assetBasePath}/tesseract`);
    expect(urls.pdfWorkerSrc).toBe(`${OCR_LIMITS.assetBasePath}/pdf.worker.min.mjs`);
    for (const url of Object.values(urls)) {
      expect(url).not.toMatch(/^https?:\/\//);
    }
  });

  it("CDN 절대 URL·상위 경로·빈 core는 로컬 에셋 실패로 그대로 던진다", () => {
    expect(() =>
      buildOcrAssetUrls({ ...VALID_MANIFEST, worker: "https://cdn.example.com/worker.min.js" }),
    ).toThrow(/로컬 OCR 에셋/);
    expect(() =>
      buildOcrAssetUrls({ ...VALID_MANIFEST, worker: "../evil/worker.min.js" }),
    ).toThrow(/로컬 OCR 에셋/);
    expect(() => buildOcrAssetUrls({ ...VALID_MANIFEST, core: [] })).toThrow(
      /로컬 OCR 에셋/,
    );
    expect(() => buildOcrAssetUrls({ ...VALID_MANIFEST, langs: [] })).toThrow(
      /언어팩/,
    );
  });
});

describe("ocr-client 소스 (런타임 외부 의존 없음)", () => {
  const here = fileURLToPath(new URL("./ocr-client.ts", import.meta.url));
  const source = readFileSync(here, "utf8");

  it("외부 http(s) URL을 하드코딩하지 않는다", () => {
    expect(source).not.toMatch(/https?:\/\//);
  });

  it("구 API 폴백(createWorker(options)·loadLanguage·initialize)이 없다", () => {
    expect(source).not.toMatch(/loadLanguage|initialize\?/);
    expect(source).not.toMatch(/createWorker\(\s*options\s*\)/);
  });

  it("고정 v7 단일 호출(createWorker(langs, oem, options))만 쓴다", () => {
    expect(source).toMatch(/createWorker\(langsToLoad, undefined, options\)/);
  });
});
