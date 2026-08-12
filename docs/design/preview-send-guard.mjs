/*
 * 발송 확인 화면(BBE-148)을 «눈으로 볼 수 있는 한 장» 으로 만든다.
 *
 * ## 왜 이 스크립트가 있나
 *
 * 이 카드가 만든 것은 «부품» 이라 자기 주소가 없다. 탭 화면은 DC-03 소유이므로
 * 여기서 라우트를 만들 수 없다. 게다가 로컬 (app) 셸은 `.env` 의 Supabase 값이 비어 있어
 * 어느 주소로 가도 500 이다(belie 가 채우기 전까지 — 2026-08-11 부터 알려진 갭).
 *
 * 그래서 컴포넌트를 **제품의 진짜 스타일시트(globals.css)로** 렌더해 자립 HTML 한 장을 만든다.
 * 검수자도 원격에서 받아 같은 명령으로 같은 그림을 다시 만들 수 있다(AGENTS.md §5).
 *
 *   node docs/design/preview-send-guard.mjs
 *   → docs/design/round-BBE-148/send-guard-preview.html
 *
 * 이 스크립트는 제품 번들에 들어가지 않는다. 검증 도구다(qa-app.mjs·dump-mockup.mjs 옆자리).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appSrc = path.join(root, "app", "src");
const outDir = path.join(root, "docs", "design", "round-BBE-148");
const outFile = path.join(outDir, "send-guard-preview.html");

/** 목업 정본의 «리드컨택 관리» 발송 칸으로 세 가지 상황을 만든다. */
const SCENARIOS = [
  {
    id: "single",
    title: "① 셀 하나 — 값을 바꾸면 즉시 안 나가고 여기를 지난다",
    note: "1건은 이름과 문구가 그대로 보이므로 확인 한 번. 건수 입력은 요구하지 않는다.",
    targets: [
      { itemId: "i1", title: "가나다상사", phone: "010-1234-5678", fields: { 대표자명: "홍길동" } },
    ],
  },
  {
    id: "bulk",
    title: "② 대량 — 한 겹 더. 건수를 직접 입력해야 눌린다",
    note: "못 보내는 건은 사유별로 따로 셈한다. 비용은 «보낼 건» 에만 붙는다.",
    targets: [
      { itemId: "i1", title: "가나다상사", phone: "010-1234-5678", fields: { 대표자명: "홍길동" } },
      { itemId: "i2", title: "라마바산업", phone: "010-2222-3333", fields: { 대표자명: "김철수" } },
      { itemId: "i3", title: "사아자물산", phone: "010-4444-5555", fields: { 대표자명: "이영희" } },
      { itemId: "i4", title: "차카타테크", phone: null, fields: {} },
      { itemId: "i5", title: "파하무역", phone: "010-9999-0000", fields: { 대표자명: "박민수" } },
    ],
    optedOut: ["01099990000"],
  },
  {
    id: "blocked",
    title: "③ 보낼 건이 없다 — 보내기 버튼이 죽어 있다",
    note: "번호가 없거나 수신 거부면 여기까지 와도 나가지 않는다.",
    targets: [{ itemId: "i1", title: "차카타테크", phone: null, fields: {} }],
  },
];

/** 업체명·대표자명은 전부 «예시» 다 — 제품에 심는 값이 아니다(D71~D75). */
const SENDER = "우리회사";

/**
 * esbuild·postcss 는 vite/tailwind 를 통해 들어오는 «간접» 의존이다.
 * 호이스팅이 달라지면 못 찾을 수 있으므로, 그때 원인을 분명히 말해 준다 —
 * 검수자가 「왜 안 되지」로 시간을 쓰게 두지 않는다.
 */
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

async function bundle() {
  const esbuild = need("esbuild");
  const entry = `
    import { renderToStaticMarkup } from "react-dom/server";
    import { planSend } from "@/lib/send-guard";
    import { SendConfirmDialog } from "@/components/send-guard/SendConfirmDialog";
    /* 확인표 id 는 서버 난수라 그림마다 달라진다. 미리보기가 매번 바뀌지 않도록 고정값을 쓴다 —
       이 하네스는 아무것도 제출하지 않으므로 실제 확인표가 필요 없다. */
    export function render(scenario, senderName) {
      const plan = planSend({
        orgId: "org-preview",
        boardId: "board-preview",
        column: { key: "color8", label: "미팅확정 메세지" },
        value: "보내기기",
        targets: scenario.targets,
        optedOutPhoneDigits: new Set(scenario.optedOut ?? []),
        senderName,
      });
      if (!plan) throw new Error("발송 계획이 만들어지지 않았습니다: " + scenario.id);
      return {
        html: renderToStaticMarkup(
          SendConfirmDialog({
            plan,
            ticketId: "preview-ticket",
            sendAction: "#",
            cancelAction: "#",
            senderLabel: senderName,
          }),
        ),
        plan,
      };
    }
  `;
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx", sourcefile: "preview-entry.tsx" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    alias: { "@": appSrc },
    external: ["react", "react-dom", "react/jsx-runtime", "react-dom/server", "node:crypto"],
  });
  return result.outputFiles[0].text;
}

async function compileCss() {
  const postcss = need("postcss");
  const tailwind = need("@tailwindcss/postcss");
  // 제품이 실제로 쓰는 스타일시트를 그대로 컴파일한다. 여기서 별도 css 를 만들면
  // «미리보기에서만 예쁜» 그림이 되어 증거로서 값이 없다.
  const globals = path.join(appSrc, "app", "globals.css");
  const result = await postcss([tailwind()]).process(fs.readFileSync(globals, "utf8"), {
    from: globals,
    to: globals,
  });
  return result.css;
}

function page(css, blocks) {
  const sections = blocks
    .map(
      (b) => `
  <section class="mwp-case">
    <h2>${b.title}</h2>
    <p class="mwp-note">${b.note}</p>
    <p class="mwp-meta">보낼 ${b.plan.sendable.length}건 · 제외 ${b.plan.excluded.length}건 ·
      예상 ${b.plan.estimatedCostKrw.toLocaleString("ko-KR")}원 ·
      건수 직접 입력 ${b.plan.requiresTypedCount ? "필요" : "불필요"}</p>
    <div class="mwp-stage">${b.html}</div>
  </section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="ko" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BBE-148 발송 확인 화면 — 렌더 증거</title>
<style>${css}</style>
<style>
  body { background: var(--mw-bg); color: var(--mw-fg); font-family: system-ui, "Malgun Gothic", sans-serif; margin: 0; padding: 20px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .mwp-lede { color: var(--mw-sub); font-size: 12px; margin: 0 0 20px; max-width: 62ch; line-height: 1.6; }
  .mwp-case { margin-bottom: 28px; }
  .mwp-case h2 { font-size: 14px; margin: 0 0 2px; }
  .mwp-note, .mwp-meta { color: var(--mw-sub); font-size: 11.5px; margin: 0 0 8px; }
  .mwp-meta { font-variant-numeric: tabular-nums; }
  /* 확인 화면은 fixed 모달이라 그대로 겹친다. 한 장에 셋을 세우려고 무대 안에 가둔다. */
  /* 가장 긴 경우(대량)가 잘리지 않을 만큼 잡는다 — 잘린 그림은 증거가 못 된다. */
  .mwp-stage { position: relative; border: 1px solid var(--mw-line); border-radius: 12px; overflow: hidden; min-height: 740px; background: var(--mw-bg); }
  .mwp-stage > [role="dialog"] { position: absolute; }
  /* 좁은 화면에서는 무대를 화면 끝까지 넓힌다.
     확인 화면은 실제 앱에서 뷰포트에 fixed 로 붙어 100vw 기준으로 폭을 줄인다.
     무대가 본문 여백만큼 좁으면 «앱에서는 안 잘리는 것» 이 미리보기에서만 잘려,
     375px 증거가 거짓이 된다. */
  @media (max-width: 480px) {
    body { padding: 12px 0; }
    h1, .mwp-lede, .mwp-case h2, .mwp-note, .mwp-meta { padding-left: 12px; padding-right: 12px; }
    .mwp-stage { border-left: 0; border-right: 0; border-radius: 0; }
  }
</style>
</head>
<body>
<h1>BBE-148 · 발송 확인 화면</h1>
<p class="mwp-lede">
  출처가 «✉ 발송» 인 칸의 값을 바꾸면 이 화면을 반드시 한 번 지난다.
  아래는 제품의 실제 컴포넌트를 제품의 실제 스타일시트(globals.css)로 렌더한 것이다.
  업체명·대표자명·번호는 전부 <b>예시</b>이며 제품 코드에 심기지 않는다(D71~D75).
  이 화면에서는 아무것도 실제로 발송되지 않는다 — 통로는 비활성이다(BBE-30).
</p>
${sections}
</body>
</html>
`;
}

/**
 * 375px 촬영용 껍데기.
 *
 * 윈도우 크롬은 창 폭을 약 500px 아래로 줄여 주지 않아 `--window-size=375` 로 찍어도
 * **레이아웃은 더 넓은 폭으로 잡히고 그림만 375 로 잘린다** — 잘린 그림은 증거가 아니다.
 * iframe 은 CSS 폭이 곧 내부 뷰포트라 375 를 정확히 만든다. 그래서 한 겹 씌운다.
 */
function mobileShell(height) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>BBE-148 · 375px</title></head>
<body style="margin:0;background:#f7f8fa">
<iframe src="send-guard-preview.html" title="375px 뷰포트"
        style="width:375px;height:${height}px;border:0;display:block"></iframe>
</body></html>
`;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const code = await bundle();
  const tmp = path.join(outDir, ".entry.mjs");
  fs.writeFileSync(tmp, code, "utf8");
  let render;
  try {
    ({ render } = await import(`${pathToFileURL(tmp).href}?t=${process.hrtime.bigint()}`));
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  const blocks = SCENARIOS.map((scenario) => ({ ...scenario, ...render(scenario, SENDER) }));
  const css = await compileCss();
  fs.writeFileSync(outFile, page(css, blocks), "utf8");
  const mobileFile = path.join(outDir, "send-guard-preview-375.html");
  fs.writeFileSync(mobileFile, mobileShell(2900), "utf8");

  console.log(`✅ ${path.relative(root, outFile)}`);
  console.log(`✅ ${path.relative(root, mobileFile)}  (375px 촬영용)`);
  for (const b of blocks) {
    console.log(
      `   ${b.id.padEnd(8)} 보낼 ${b.plan.sendable.length}건 · 제외 ${b.plan.excluded.length}건 · ` +
        `${b.plan.estimatedCostKrw}원 · 건수입력 ${b.plan.requiresTypedCount ? "요구" : "미요구"}`,
    );
  }
  console.log("   ⚠️ 이 스크립트는 아무것도 발송하지 않는다. 네트워크를 열지 않는다.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
