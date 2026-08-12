/*
 * 이중 잠금 게이트(BBE-105)를 «눈으로 볼 수 있는 한 장» 으로 만든다.
 *
 * ## 왜 이 스크립트가 있나
 *
 * `LockBlockedDialog`·`LockToggleSettingsRow` 는 아직 어떤 실제 보드에도 마운트되지 않은
 * «부품» 이다(목업의 «리드컨택 → 업무이동» 화면이 app/src 에 아직 없다 — README 참고).
 * 자기 주소가 없으니 라우트를 열어 찍을 수 없다. 로컬 (app) 셸도 `.env` 의 Supabase 값이
 * 비어 있어 어느 주소로 가도 500 이다(기존 갭, 이 카드 탓 아님).
 *
 * 그래서 제품 컴포넌트를 제품 스타일시트(globals.css)로 렌더하는 하네스를 쓴다 —
 * BBE-148 의 `preview-send-guard.mjs` 와 같은 패턴.
 *
 *   node docs/design/preview-lock.mjs
 *   → docs/design/round-BBE-105/lock-preview.html       (1440px 확인용)
 *   → docs/design/round-BBE-105/lock-preview-375.html   (375px 촬영용 iframe 껍데기)
 *
 * ⚠ 이 컴포넌트는 CSS Modules(`lock.module.css`) 를 쓴다 — Tailwind 유틸이 아니다.
 * esbuild 는 CSS Modules 의 클래스명 해싱을 하지 않으므로, `*.module.css` import 를
 * «각 클래스명을 자기 자신으로 매핑하는 객체» 로 치환하는 얕은 플러그인을 쓴다
 * (이 페이지 하나에서만 쓰이므로 충돌 걱정이 없다 — 실제 프로덕션 빌드는 Next.js 가 정식으로
 * 해싱한다). 원본 CSS 텍스트는 그대로 페이지에 박아 클래스 선택자가 실제로 맞물리게 한다.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appSrc = path.join(root, "app", "src");
const outDir = path.join(root, "docs", "design", "round-BBE-105");
const outFile = path.join(outDir, "lock-preview.html");

function need(name) {
  try {
    return require(name);
  } catch {
    throw new Error(
      `«${name}» 를 찾지 못했습니다. 저장소 루트에서 \`npm install\` 을 먼저 돌리세요.\n` +
        `(이 스크립트는 검증 도구라 제품 의존성에 추가하지 않습니다.)`,
    );
  }
}

/** *.module.css → 클래스명을 자기 자신으로 매핑하는 JS 객체로 치환하는 esbuild 플러그인. */
function makeCssModuleStubPlugin(cssModuleFiles) {
  return {
    name: "css-module-stub",
    setup(build) {
      build.onResolve({ filter: /\.module\.css$/ }, (args) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        cssModuleFiles.add(resolved);
        return { path: resolved, namespace: "css-module-stub" };
      });
      build.onLoad({ filter: /.*/, namespace: "css-module-stub" }, (args) => {
        const source = fs.readFileSync(args.path, "utf8");
        const classNames = [...source.matchAll(/\.([a-zA-Z_][\w-]*)\s*[{,]/g)].map((m) => m[1]);
        const unique = [...new Set(classNames)];
        const entries = unique.map((name) => `${JSON.stringify(name)}: ${JSON.stringify(name)}`).join(",");
        return { contents: `export default {${entries}};`, loader: "js" };
      });
    },
  };
}

async function bundle() {
  const esbuild = need("esbuild");
  // ★ 컴포넌트를 일반 함수처럼 직접 호출하지 않는다 — 그러면 useState 가 React 의 렌더
  // 컨텍스트 밖에서 실행돼 dispatcher 가 null 이라 죽는다("Cannot read properties of null
  // (reading 'useState')"). 반드시 JSX(=React.createElement)로 만들어야 훅이 산다.
  const entry = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { LockBlockedDialog } from "@/components/automation-presets/lock/LockBlockedDialog";
    import { LockToggleSettingsRow } from "@/components/automation-presets/lock/LockToggleSettingsRow";
    export function renderBlocked(unmet) {
      return renderToStaticMarkup(
        <LockBlockedDialog unmet={unmet} onNavigateToCondition={() => {}} onRequestApproval={() => {}} onClose={() => {}} />,
      );
    }
    export function renderToggle(props) {
      return renderToStaticMarkup(<LockToggleSettingsRow {...props} />);
    }
  `;
  const cssModuleFiles = new Set();
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx", sourcefile: "preview-entry.tsx" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    alias: { "@": appSrc },
    plugins: [makeCssModuleStubPlugin(cssModuleFiles)],
    external: ["react", "react-dom", "react/jsx-runtime", "react-dom/server"],
  });
  return { code: result.outputFiles[0].text, cssModuleFiles: [...cssModuleFiles] };
}

async function compileCss() {
  const postcss = need("postcss");
  const tailwind = need("@tailwindcss/postcss");
  const globals = path.join(appSrc, "app", "globals.css");
  const result = await postcss([tailwind()]).process(fs.readFileSync(globals, "utf8"), {
    from: globals,
    to: globals,
  });
  return result.css;
}

function mobileShell(height) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>BBE-105 · 375px</title></head>
<body style="margin:0;background:#f7f8fa">
<iframe src="lock-preview.html" title="375px 뷰포트"
        style="width:375px;height:${height}px;border:0;display:block"></iframe>
</body></html>
`;
}

function page(css, moduleCss, blocks) {
  const sections = blocks
    .map(
      (b) => `
  <section class="mwp-case">
    <h2>${b.title}</h2>
    <p class="mwp-note">${b.note}</p>
    <div class="mwp-stage ${b.stageClass ?? ""}">${b.html}</div>
  </section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="ko" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BBE-105 이중 잠금 게이트 — 렌더 증거</title>
<style>${css}</style>
<style>${moduleCss}</style>
<style>
  body { background: var(--mw-bg); color: var(--mw-fg); font-family: system-ui, "Malgun Gothic", sans-serif; margin: 0; padding: 20px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .mwp-lede { color: var(--mw-sub); font-size: 12px; margin: 0 0 20px; max-width: 62ch; line-height: 1.6; }
  .mwp-case { margin-bottom: 28px; }
  .mwp-case h2 { font-size: 14px; margin: 0 0 2px; }
  .mwp-note { color: var(--mw-sub); font-size: 11.5px; margin: 0 0 8px; }
  .mwp-stage { position: relative; border: 1px solid var(--mw-line); border-radius: 12px; overflow: hidden; min-height: 320px; background: var(--mw-bg); padding: 20px; }
  .mwp-stage.overlay-stage { padding: 0; min-height: 420px; }
  .mwp-stage.overlay-stage > div { position: static; }
  @media (max-width: 480px) {
    body { padding: 12px 0; }
    h1, .mwp-lede, .mwp-case h2, .mwp-note { padding-left: 12px; padding-right: 12px; }
    .mwp-stage { border-left: 0; border-right: 0; border-radius: 0; }
  }
</style>
</head>
<body>
<h1>BBE-105 · 이중 잠금 게이트</h1>
<p class="mwp-lede">
  «업무이동 = 업무관리 이동» 을 시도했는데 조건이 미충족이면 이 화면이 뜬다. 아래는 제품의
  실제 컴포넌트를 제품의 실제 스타일시트(globals.css + lock.module.css)로 렌더한 것이다.
  이 컴포넌트는 아직 어떤 보드에도 마운트되지 않았다 — 부품 확인용이다.
</p>
${sections}
</body>
</html>
`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const { code, cssModuleFiles } = await bundle();
  const tmp = path.join(outDir, ".entry.mjs");
  fs.writeFileSync(tmp, code, "utf8");
  let renderBlocked, renderToggle;
  try {
    ({ renderBlocked, renderToggle } = await import(`${pathToFileURL(tmp).href}?t=${process.hrtime.bigint()}`));
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  const moduleCss = cssModuleFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");

  const blocks = [
    {
      title: "① 차단 — 직인 미승인 상태에서 이관 시도",
      note: "목업 showBlock 과 동일 조건(직인 완료 ≠ 완료). 사유 + «채우러 가기» + «요청 보내기».",
      stageClass: "overlay-stage",
      html: renderBlocked([
        { key: "seal_approval", label: "대표 직인 승인", satisfied: false, currentValueLabel: "대기" },
      ]),
    },
    {
      title: "② 설정 — 이중 잠금 켜짐(기본값)",
      note: "회사 설정에서 켜져 있으면 위 차단이 걸린다.",
      html: renderToggle({ enabled: true, lastAudit: null, onSubmit: () => {}, error: null }),
    },
    {
      title: "③ 설정 — 이중 잠금 꺼짐 + 최근 변경 이력",
      note: "D66 — 회사가 끌 수 있다. 끈 사유가 감사 기록에 남아 행 안에 표시된다.",
      html: renderToggle({
        enabled: false,
        lastAudit: { actor: "박정화 실장", enabled: false, reason: "소규모 팀이라 직인 확인을 생략합니다", at: "2026-08-11T09:00:00.000Z" },
        onSubmit: () => {},
        error: null,
      }),
    },
  ];

  const css = await compileCss();
  fs.writeFileSync(outFile, page(css, moduleCss, blocks), "utf8");
  const mobileFile = path.join(outDir, "lock-preview-375.html");
  fs.writeFileSync(mobileFile, mobileShell(1400), "utf8");

  console.log(`✅ ${path.relative(root, outFile)}`);
  console.log(`✅ ${path.relative(root, mobileFile)}  (375px 촬영용)`);
  console.log("   3가지 상태: 차단 다이얼로그 · 잠금 켜짐 · 잠금 꺼짐+이력");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
