import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceMark } from "./WorkspaceMark";

// ★ 왜 이 파일이 따로 있나 (BBE-199)
// WorkspaceMark.test.ts 는 순수 함수 workspaceInitial() 만 부른다. 그래서 컴포넌트의
// «이니셜 분기» 를 통째로 지워도 그 테스트는 전부 초록이었다 — 검사 경계가 실행 경로보다 좁았다.
// 이 파일은 컴포넌트를 실제로 렌더해서 «화면에 무엇이 나오는가» 를 잰다.

describe("WorkspaceMark 렌더 — 빈칸을 만들지 않는다", () => {
  it("서명 URL이 있으면 이미지를 그린다", () => {
    const html = renderToStaticMarkup(
      <WorkspaceMark name="샘플 회사" signedImageUrl="https://storage.example.invalid/signed/logo.png" />,
    );
    expect(html).toContain("<img");
    expect(html).toContain("https://storage.example.invalid/signed/logo.png");
  });

  it("★ 로고가 없으면 회사명 이니셜이 화면에 나온다 (빈칸 금지)", () => {
    const html = renderToStaticMarkup(<WorkspaceMark name="샘플 회사" signedImageUrl={null} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("샘");
  });

  it("★ 로고 없이 영문 이름이면 두 글자 이니셜이 나온다", () => {
    const html = renderToStaticMarkup(<WorkspaceMark name="MoaWork Lab" />);
    expect(html).not.toContain("<img");
    expect(html).toContain("MO");
  });

  it("이니셜로 쓸 글자가 없으면 브랜드 폴백이 나온다 — 그래도 빈칸이 아니다", () => {
    const html = renderToStaticMarkup(<WorkspaceMark name="!!!" />);
    expect(html).toContain('data-mark-fallback="brand"');
  });

  it("장식이 아닐 때는 접근성 이름을 준다", () => {
    const html = renderToStaticMarkup(<WorkspaceMark name="샘플 회사" decorative={false} />);
    expect(html).toContain('role="img"');
    expect(html).toContain("샘플 회사 회사 표식");
  });
});
