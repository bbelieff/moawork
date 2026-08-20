import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PostHogProvider } from "@/components/analytics/PostHogProvider";
import { PRODUCT_NAME } from "@/lib/product";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — 통합관리시스템`,
  description: "업무 통합관리 — 영업·업무·정산을 한곳에서.",
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/moawork-app-icon-light-transparent-512.png",
  },
};

// 최초 페인트 전에 저장된 테마를 <html data-theme> 로 확정해 FOUC 를 막는다.
// 저장값이 없으면 attribute 를 붙이지 않고 CSS 의 prefers-color-scheme 가 처리한다.
// (ThemeToggle 과 동일한 키 "mw-theme" — 값 변경 시 양쪽을 함께 바꾼다.)
const THEME_INIT = `try{var t=localStorage.getItem("mw-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      {/* PostHogProvider 는 DOM 을 그리지 않는다 — 레이아웃·반응형에 영향 0. */}
      <body className="min-h-full flex flex-col">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
