"use client";

import { useCallback } from "react";
import {
  SupporterDock,
  SupporterOpenButton,
  SupporterProvider,
  type SupporterStatusTransport,
} from "@/components/supporter";

/**
 * 서포터 시각 픽스처 — 합성 데이터로 실제 컴포넌트를 눈으로 확인하는 자리.
 *
 * - 세션을 읽지 않고(서버의 getSessionOrNull·플랫폼 판정을 부르지 않음)
 *   운영 호출을 하지 않는다. transport stub 은 정확한 미연결 메타데이터에
 *   대한 승인/거부 판정만 흉내 낸다.
 * - 가짜 성공 메시지·실제 자격증명을 절대 만들지 않는다.
 * - 운영 배선(app 레이아웃·PlatformShell)은 이 transport 를 쓰지 않는다.
 */
export function SupporterFixtureSurface({
  contextKey,
  allowOperations,
  grantOperations,
  failUser,
}: {
  /** 합성 컨텍스트 키. 실제 회사 ID·세션을 넣지 않는다. */
  contextKey: string;
  allowOperations: boolean;
  /** stub transport 가 운영 승인을 낸 것처럼 할지. */
  grantOperations: boolean;
  /** stub transport 가 user 조회마저 실패한 것처럼 할지. */
  failUser: boolean;
}) {
  // useCallback 으로 고정 — 매 렌더 새 함수면 상태 조회 effect 가 무한 재실행된다.
  const transport: SupporterStatusTransport = useCallback(
    async (mode) => {
      if (mode === "operations") return grantOperations;
      return !failUser;
    },
    [grantOperations, failUser],
  );
  return (
    <SupporterProvider
      contextKey={contextKey}
      allowOperations={allowOperations}
      initialOpen
      statusTransport={transport}
    >
      <SupporterOpenButton />
      <SupporterDock />
    </SupporterProvider>
  );
}
