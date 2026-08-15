import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { OnboardingPanel } from "../src/components/onboarding/OnboardingPanel";
import { AUTOMATION_QUEST_VISUAL_FIXTURE } from "../src/lib/onboarding/visual-fixture";

const output = resolve(process.argv[2] ?? ".visual-evidence/bbe-113/index.html");
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssDir = resolve(appRoot, ".next/static/chunks");
const css = readdirSync(cssDir)
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(resolve(cssDir, name), "utf8"))
  .join("\n");

const panel = renderToStaticMarkup(
  <OnboardingPanel
    snapshot={AUTOMATION_QUEST_VISUAL_FIXTURE}
    revalidatePath="/onboarding/practice"
    showManagementByDefault
  />,
);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>BBE-113 automation quest fixture</title>
    <style>${css}</style>
    <style>
      :root { --mw-card:#fff; --mw-line:#d9dde5; --mw-sub:#667085; --mw-text:#172033; }
      body { margin:0; background:#f6f8fb; color:var(--mw-text); font-family:Arial,"Noto Sans KR",sans-serif; }
      main { max-width:760px; margin:0 auto; padding:32px 20px; }
      header { margin-bottom:16px; }
      header p { color:var(--mw-sub); font-size:14px; margin:0 0 4px; }
      header h1 { font-size:24px; margin:0; }
    </style>
  </head>
  <body>
    <main>
      <header><p>온보딩 · isolated component fixture</p><h1>연습 회사 퀘스트</h1></header>
      ${panel}
    </main>
  </body>
</html>`, "utf8");

console.log(output);
