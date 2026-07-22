"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * 전역 클라이언트 프로바이더 셸.
 * 현재는 TanStack Query 만. 후속 트랙이 Auth/Theme 등 프로바이더를 여기에 중첩한다.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
