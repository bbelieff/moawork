// BBE-206 — 「정의된 적 없는 CSS 변수를 참조하는 곳」을 게이트에서 막는다.
//
// ★ 왜 이 게이트가 필요한가
//   `var(--없는토큰)` 은 «조용히» 무효가 된다. 빌드도 lint 도 타입검사도 통과하고,
//   화면에서만 티가 난다 — 그것도 보는 사람이 알아채야만.
//
//   BBE-199 에서 실제로 일어난 일: workspace-switcher.module.css 가 --moawork-* 를
//   참조했는데 그 토큰을 담은 파일은 **import 되지 않는 «보존 사본»** 이었다.
//   결과는 background 가 투명으로 떨어지고 글자색은 흰색 → **로고 없는 회사의
//   이니셜 마크가 «보이지 않았다».** 20종 변이도 렌더 테스트도 못 잡았다.
//   HTML 에 글자는 «있었기» 때문이다. 사람이 화면을 열어야만 보였다.
//
//   ★ 그런데 「정의 없는 var() 참조」 자체는 **기계가 셀 수 있다.**
//     사람 눈에만 보이는 것과 기계가 잡을 수 있는 것을 가른 자리가 이 게이트다.
//
// ★ 오탐을 내지 않는 것이 이 게이트의 생명이다 — 오탐이 나면 아무도 안 쓴다.
//   그래서 아래 셋을 «정상» 으로 취급한다:
//     ① 폴백이 있는 참조  var(--x, #fff)      → 정의가 없어도 의도된 기본값이 있다
//     ② 주석 안의 참조                          → 코드가 아니다
//     ③ 런타임 주입 변수  next/font 의 variable → CSS 텍스트에 정의가 없는 게 정상이다

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCAN_ROOT = join(ROOT, "app", "src");

/** CSS 주석 제거. 여기서 --nav 같은 «주석 속 예시» 가 오탐으로 잡혔었다. */
export function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ");
}

/**
 * TS/TSX 주석 제거.
 * `//` 는 `https://` 같은 URL 을 잘라 «참조를 못 보는» 오검출을 만들 수 있으므로,
 * 바로 앞이 `:` 인 경우는 주석으로 보지 않는다.
 */
export function stripTsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/u, "$1"))
    .join("\n");
}

const strip = (file, source) => (file.endsWith(".css") ? stripCssComments(source) : stripTsComments(source));

/** `var(--x)` 중 **폴백이 없는** 것만 돌려준다. 폴백이 있으면 의도된 기본값이 있다. */
export function referencesWithoutFallback(source) {
  const found = [];
  for (const match of source.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/gu)) {
    if (match[2] === ")") found.push(match[1]);
  }
  return found;
}

/** 이 소스가 «정의» 하는 커스텀 프로퍼티. */
export function definitionsIn(file, source) {
  const defined = new Set();
  if (file.endsWith(".css")) {
    for (const m of source.matchAll(/(--[A-Za-z0-9_-]+)\s*:/gu)) defined.add(m[1]);
    return defined;
  }
  // 인라인 style 객체의 커스텀 프로퍼티 키:  { "--x": value }
  for (const m of source.matchAll(/["'](--[A-Za-z0-9_-]+)["']\s*:/gu)) defined.add(m[1]);
  // ★ next/font 가 «런타임에» 주입하는 변수:  variable: "--font-geist-sans"
  //   CSS 텍스트에 정의가 없는 것이 정상이다. 이걸 모르면 오탐이 난다.
  for (const m of source.matchAll(/variable\s*:\s*["'](--[A-Za-z0-9_-]+)["']/gu)) defined.add(m[1]);
  return defined;
}

/**
 * 테스트 파일은 «검사 대상이 아니다».
 *
 * ★ 오탐 사례가 실제로 있었다 — status-semantics.contract.test.tsx 가
 *   `expect(source).not.toContain("var(--mw-border)")` 로 **없어야 함을 단언**하는데,
 *   그 문자열 때문에 위반으로 잡혔다. 테스트는 화면에 렌더되지 않으므로 제외한다.
 */
export function isTestFile(name) {
  return /\.(test|spec)\.[jt]sx?$/u.test(name);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(css|tsx?|jsx?)$/u.test(name) && !isTestFile(name)) out.push(full);
  }
  return out;
}

/**
 * 실제로 «로드되는» CSS 파일만 정의 출처로 인정한다.
 *
 * ★ 이것이 이 게이트의 핵심이다. 모든 CSS 를 정의로 세면 BBE-199 를 못 잡는다 —
 *   그 토큰들은 **import 되지 않는 파일**에 정의돼 있었기 때문이다.
 *   side-effect import 와 `import styles from "...module.css"` 를 «둘 다» 본다.
 */
export function loadedCssFiles(files, readFile) {
  const cssFiles = files.filter((f) => f.endsWith(".css"));
  const loaded = new Set();
  for (const file of files) {
    const source = strip(file, readFile(file));
    const specs = [
      ...source.matchAll(/import\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+\.css)["']/gu),
      ...source.matchAll(/@import\s+["']([^"']+\.css)["']/gu),
    ].map((m) => m[1]);
    for (const spec of specs) {
      if (spec.startsWith(".")) {
        const abs = resolve(dirname(file), spec);
        if (cssFiles.includes(abs)) loaded.add(abs);
      } else {
        // 별칭(@/...) 등은 파일명 끝으로 맞춘다.
        const tail = spec.split("/").pop();
        for (const css of cssFiles) if (css.endsWith(tail)) loaded.add(css);
      }
    }
  }
  return loaded;
}

export function analyze(files, readFile) {
  const loadedCss = loadedCssFiles(files, readFile);
  const defined = new Set();
  for (const file of files) {
    if (file.endsWith(".css") && !loadedCss.has(file)) continue; // 로드 안 되는 CSS 는 정의가 아니다
    for (const token of definitionsIn(file, strip(file, readFile(file)))) defined.add(token);
  }

  const violations = [];
  for (const file of files) {
    if (file.endsWith(".css") && !loadedCss.has(file)) continue;
    const source = strip(file, readFile(file));
    source.split("\n").forEach((line, index) => {
      for (const token of referencesWithoutFallback(line)) {
        if (!defined.has(token)) violations.push({ file, line: index + 1, token });
      }
    });
  }
  return { violations, definedCount: defined.size, loadedCssCount: loadedCss.size };
}

function selfTest() {
  // 경로는 «실제 절대경로» 로 만든다. 상대경로 해석이 플랫폼마다 달라
  // 픽스처가 조용히 「로드 안 됨」으로 잡히면 self-test 가 거짓말을 한다(실제로 겪었다).
  const dir = join(ROOT, "__selftest__");
  const p = (name) => join(dir, name);
  let files = {};
  const read = (f) => files[f];
  const run = (names) => analyze(names.map(p), read);
  const set = (obj) => {
    files = {};
    for (const [k, v] of Object.entries(obj)) files[p(k)] = v;
  };
  const expect = (actual, want, message) => {
    if (actual !== want) throw new Error(`self-test: ${message} (기대 ${want}, 실제 ${actual})`);
  };

  // ① ★ 폴백이 있으면 정의가 없어도 통과 — 오탐 금지. 이게 깨지면 아무도 이 게이트를 안 쓴다.
  set({ "b.tsx": "const s={color:'var(--nope, #fff)'}" });
  expect(run(["b.tsx"]).violations.length, 0, "폴백 있는 참조를 잡으면 안 된다");

  // ② 주석 안의 참조는 잡지 않는다 (--nav 오탐의 원인이었다)
  set({ "c.css": "/* .x { width: var(--ghost) } */ :root{--real:1px}", "c.tsx": 'import "./c.css";' });
  expect(run(["c.css", "c.tsx"]).violations.length, 0, "주석 속 참조를 잡으면 안 된다");

  // ③ 정의 없는 참조는 잡는다
  set({ "d.css": ".x{color:var(--missing)}", "d.tsx": 'import "./d.css";' });
  const three = run(["d.css", "d.tsx"]);
  expect(three.violations.length, 1, "정의 없는 참조를 잡아야 한다");
  expect(three.violations[0].token, "--missing", "잡은 토큰 이름이 맞아야 한다");

  // ③-b ★ 로드되지 않는 CSS 는 정의도 참조도 «둘 다» 보지 않는다.
  //   한쪽만 무시하면 자기 안에서 자기 토큰을 참조하는 «보존 사본» 이 통째로 오탐이 된다
  //   (moawork-color-tokens.css 가 정확히 그 모양이다).
  set({ "orphan2.css": ":root{--a:var(--b);--b:#fff}" });
  expect(run(["orphan2.css"]).violations.length, 0, "로드 안 되는 CSS 를 오탐하면 안 된다");

  // ④ ★ BBE-199 재현 — import 되지 않는 파일의 정의는 «정의가 아니다»
  set({
    "orphan.css": ":root{--brand:#fff}",
    "used.module.css": ".m{background:var(--brand)}",
    "comp.tsx": 'import styles from "./used.module.css";',
  });
  expect(run(["orphan.css", "used.module.css", "comp.tsx"]).violations.length, 1,
    "import 안 되는 CSS 의 정의를 인정하면 BBE-199 를 못 잡는다");

  // ⑤ import 되면 정의로 인정한다 (side-effect + default import 둘 다)
  set({
    "tokens.css": ":root{--brand:#fff}",
    "used.module.css": ".m{background:var(--brand)}",
    "comp.tsx": 'import "./tokens.css";\nimport styles from "./used.module.css";',
  });
  expect(run(["tokens.css", "used.module.css", "comp.tsx"]).violations.length, 0,
    "import 된 CSS 의 정의는 인정해야 한다");

  // ⑥ next/font 런타임 주입 변수는 정의로 본다 (오탐 금지)
  set({
    "layout.tsx": 'import "./g.css";\nconst f = { variable: "--font-geist-sans" };',
    "g.css": "body{font-family:var(--font-geist-sans)}",
  });
  expect(run(["layout.tsx", "g.css"]).violations.length, 0, "next/font 주입 변수를 잡으면 안 된다");

  // ⑦ URL 의 // 를 주석으로 오해해 참조를 «놓치지» 않는다
  set({ "u.tsx": 'const a="https://x.example"; const s={color:"var(--missing)"};' });
  expect(run(["u.tsx"]).violations.length, 1, "URL 뒤의 참조를 놓치면 안 된다");

  // ⑧ @import 로 연결된 CSS 도 정의로 인정한다 (globals.css → moawork-tokens.css 구조)
  set({
    "entry.css": '@import "./inner.css";\n.x{color:var(--deep)}',
    "inner.css": ":root{--deep:#000}",
    "app.tsx": 'import "./entry.css";',
  });
  expect(run(["entry.css", "inner.css", "app.tsx"]).violations.length, 0,
    "@import 로 실린 정의를 인정해야 한다");

  console.log("css token reference self-test: 9 passed");
}

const BASELINE_PATH = join(ROOT, "scripts", "css-token-baseline.json");

/** `파일|토큰` — 줄 번호는 넣지 않는다. 줄이 밀렸다고 게이트가 흔들리면 안 된다. */
const keyOf = (v) => `${relative(ROOT, v.file).replace(/\\/gu, "/")}|${v.token}`;

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const files = walk(SCAN_ROOT);
  const cache = new Map();
  const read = (f) => {
    if (!cache.has(f)) cache.set(f, readFileSync(f, "utf8"));
    return cache.get(f);
  };
  const { violations, loadedCssCount } = analyze(files, read);

  let baseline = [];
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")).known ?? [];
  } catch {
    baseline = [];
  }
  const allowed = new Map(baseline.map((entry) => [`${entry.file}|${entry.token}`, entry]));

  const fresh = violations.filter((v) => !allowed.has(keyOf(v)));
  const seen = new Set(violations.map(keyOf));
  // ★ 래칫 — 이미 고쳐진 항목이 baseline 에 남아 있으면 «실패» 다.
  //   그래야 원인이 사라진 순간 예외도 반드시 지워진다. baseline 이 영구 면죄부가 되지 않는다.
  const stale = [...allowed.keys()].filter((key) => !seen.has(key));

  if (fresh.length === 0 && stale.length === 0) {
    console.log(
      `css token references: ${files.length} files, ${loadedCssCount} loaded stylesheets, ` +
      `0 new undefined references (baseline ${allowed.size})`,
    );
    return;
  }

  if (fresh.length > 0) {
    console.error("정의된 적 없는 CSS 변수를 참조합니다 (폴백도 없습니다):");
    for (const v of fresh) console.error(`  ${relative(ROOT, v.file)}:${v.line}  ${v.token}`);
    console.error("");
    console.error("고치는 법 — 둘 중 하나:");
    console.error("  1) 정본 토큰으로 바꾼다          예: var(--mw-border) → var(--mw-line)");
    console.error("  2) 의도한 기본값을 폴백으로 준다   예: var(--x, #fff)");
    console.error("이 참조는 조용히 무효가 되어 «화면에서만» 티가 납니다(BBE-199).");
  }
  if (stale.length > 0) {
    console.error("");
    console.error("baseline 이 낡았습니다 — 아래는 이미 고쳐졌으니 scripts/css-token-baseline.json 에서 지우세요:");
    for (const key of stale) console.error(`  ${key}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
