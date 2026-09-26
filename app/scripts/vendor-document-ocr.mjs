#!/usr/bin/env node
/**
 * vendor-document-ocr.mjs — 브라우저 OCR 자체호스팅 에셋을 node_modules에서
 * app/public/document-ocr 로 복사하고 manifest.json을 쓴다.
 *
 * 원칙:
 * - 공인 npm 패키지에서만 가져온다 (네트워크 다운로드 없음, 이 스크립트는
 *   로컬 node_modules만 읽는다).
 * - 런타임 CDN 호출 금지: worker·core·언어·pdf worker 전부 same-origin.
 * - 바이너리는 git에 넣지 않는다. `npm run build`가 먼저 이 스크립트를
 *   실행하므로 VPS/CI도 hermetic하게 재생성된다.
 * - 언어 데이터는 LSTM 전용 best_int (기본 OEM=LSTM_ONLY와 같은 조합).
 *   worker에는 gzip:true로 넘기므로 *.traineddata.gz 파일명을 그대로 둔다.
 *
 * 출처 (모두 Apache-2.0):
 * - tesseract.js 7.0.0 ......... https://registry.npmjs.org/tesseract.js/-/tesseract.js-7.0.0.tgz
 * - tesseract.js-core 7.0.0 ..... https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-7.0.0.tgz
 * - pdfjs-dist 6.3.289 .......... https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.3.289.tgz
 * - @tesseract.js-data/kor 1.0.0  https://registry.npmjs.org/@tesseract.js-data/kor/-/kor-1.0.0.tgz
 *                                 (원본: https://github.com/tesseract-ocr/tessdata_fast, Apache-2.0)
 * - @tesseract.js-data/eng 1.0.0  https://registry.npmjs.org/@tesseract.js-data/eng/-/eng-1.0.0.tgz
 *
 * 용량 안내 (vendor 실행 시 실제 bytes 출력):
 * - tesseract-core-simd-lstm 1쌍(js+wasm) 약 6.8MB — 대부분 데스크톱/모바일
 *   브라우저의 WASM SIMD를 가정한다. 미지원 기기는 인식 단계에서 오류로
 *   안내되며 (조용히 틀린 값을 내지 않는다), 필요시 plain-lstm 쌍을 추가
 *   벤더하도록 manifest.core에 확장한다.
 * - kor best_int .gz 약 1.6MB, eng best_int .gz 약 2.9MB.
 */

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const outDir = join(appDir, "public", "document-ocr");
const tesseractDir = join(outDir, "tesseract");

const CHECK = process.argv.includes("--check");

function findPackageDir(name) {
  let dir = appDir;
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `node_modules에서 '${name}'을 찾지 못했습니다. 워크스페이스 루트에서 npm ci를 먼저 실행하세요.`,
  );
}

function pkgVersion(name) {
  const raw = readFileSync(join(findPackageDir(name), "package.json"), "utf8");
  return JSON.parse(raw).version;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** [소스패키지/소스경로, 출력경로] */
const tessJs = findPackageDir("tesseract.js");
const tessCore = findPackageDir("tesseract.js-core");
const pdfjs = findPackageDir("pdfjs-dist");
const korData = findPackageDir("@tesseract.js-data/kor");
const engData = findPackageDir("@tesseract.js-data/eng");

const coreJs = "tesseract-core-simd-lstm.wasm.js";
const coreWasm = "tesseract-core-simd-lstm.wasm";

const plan = [
  [join(tessJs, "dist", "worker.min.js"), join(outDir, "worker.min.js")],
  [join(tessCore, coreJs), join(tesseractDir, coreJs)],
  [join(tessCore, coreWasm), join(tesseractDir, coreWasm)],
  [
    join(korData, "4.0.0_best_int", "kor.traineddata.gz"),
    join(tesseractDir, "kor.traineddata.gz"),
  ],
  [
    join(engData, "4.0.0_best_int", "eng.traineddata.gz"),
    join(tesseractDir, "eng.traineddata.gz"),
  ],
  [join(pdfjs, "build", "pdf.worker.min.mjs"), join(outDir, "pdf.worker.min.mjs")],
];

const tesseractJsVersion = pkgVersion("tesseract.js");
const tesseractCoreVersion = pkgVersion("tesseract.js-core");
const pdfjsVersion = pkgVersion("pdfjs-dist");

const manifest = {
  package: "document-ocr-assets v1",
  tesseractJs: tesseractJsVersion,
  tesseractCore: tesseractCoreVersion,
  pdfjs: pdfjsVersion,
  worker: "worker.min.js",
  core: [coreJs, coreWasm],
  langs: ["kor", "eng"],
  langVariant: "4.0.0_best_int",
  gzip: true,
  license: "Apache-2.0",
  sources: {
    "tesseract.js": `https://registry.npmjs.org/tesseract.js/-/tesseract.js-${tesseractJsVersion}.tgz`,
    "tesseract.js-core": `https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-${tesseractCoreVersion}.tgz`,
    "pdfjs-dist": `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-${pdfjsVersion}.tgz`,
    "@tesseract.js-data/kor":
      "https://registry.npmjs.org/@tesseract.js-data/kor/-/kor-1.0.0.tgz (원본: https://github.com/tesseract-ocr/tessdata_fast)",
    "@tesseract.js-data/eng":
      "https://registry.npmjs.org/@tesseract.js-data/eng/-/eng-1.0.0.tgz (원본: https://github.com/tesseract-ocr/tessdata_fast)",
  },
};

function fail(message) {
  console.error(`vendor:document-ocr: ${message}`);
  process.exit(1);
}

for (const [src] of plan) {
  if (!existsSync(src)) fail(`소스 없음: ${src}`);
}

if (CHECK) {
  const manifestPath = join(outDir, "manifest.json");
  if (!existsSync(manifestPath)) fail("manifest.json 없음 — vendor를 먼저 실행하세요.");
  const current = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const key of ["tesseractJs", "tesseractCore", "pdfjs", "worker", "langVariant"]) {
    if (current[key] !== manifest[key]) {
      fail(`manifest 불일치(${key}): ${current[key]} !== ${manifest[key]} — vendor를 다시 실행하세요.`);
    }
  }
  for (const [src, dest] of plan) {
    if (!existsSync(dest)) fail(`에셋 없음: ${dest}`);
    if (sha256(src) !== sha256(dest)) fail(`에셋 stale: ${dest} — vendor를 다시 실행하세요.`);
  }
  console.log("vendor:document-ocr --check OK");
  process.exit(0);
}

mkdirSync(tesseractDir, { recursive: true });
const files = [];
for (const [src, dest] of plan) {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
  const bytes = readFileSync(dest).length;
  if (bytes === 0) fail(`빈 파일 복사됨: ${dest}`);
  files.push({ dest, bytes, sha256: sha256(dest).slice(0, 16) });
}

// gzip 매직(1F 8B) · wasm 매직(\0asm) sanity — 잘못된 파일을 조용히 두지 않는다.
for (const lang of ["kor", "eng"]) {
  const head = readFileSync(join(tesseractDir, `${lang}.traineddata.gz`)).subarray(0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) fail(`${lang} 언어팩이 gzip이 아닙니다.`);
}
{
  const head = readFileSync(join(tesseractDir, coreWasm)).subarray(0, 4);
  if (head[0] !== 0x00 || head[1] !== 0x61 || head[2] !== 0x73 || head[3] !== 0x6d) {
    fail("core wasm 매직이 아닙니다.");
  }
}

manifest.files = Object.fromEntries(
  files.map(({ dest, bytes, sha256: hash }) => [
    dest.slice(outDir.length + 1).replace(/\\/g, "/"),
    { bytes, sha256_16: hash },
  ]),
);
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const total = files.reduce((sum, f) => sum + f.bytes, 0);
console.log("vendor:document-ocr OK");
for (const f of files) {
  console.log(`  ${(f.bytes / 1024 / 1024).toFixed(2)}MB  ${f.dest.slice(outDir.length + 1)}`);
}
console.log(`  total ${(total / 1024 / 1024).toFixed(2)}MB`);
