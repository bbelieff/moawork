// Tailwind CSS v4 는 CSS-first(globals.css 의 `@import "tailwindcss"`) 설정이지만,
// 테마 확장·content 경로를 코드로 관리할 수 있도록 config 파일을 둔다.
// globals.css 의 `@config` 디렉티브로 이 파일이 로드된다. T03 등 후속 트랙이
// theme.extend(색상/폰트/스페이싱 토큰)를 여기서 확장한다.
const config = {
  content: [
    "./src/**/*.{ts,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
