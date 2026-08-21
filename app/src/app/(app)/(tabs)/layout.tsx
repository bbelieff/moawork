"use client";

import type { ReactNode } from "react";
import { AppTabs } from "@/components/shell/AppTabs";
import { useAppTabsLayoutData } from "@/components/shell/AppTabsLayoutData";

export default function TabsLayout({ children }: { children: ReactNode }) {
  const appTabs = useAppTabsLayoutData();

  return (
    <>
      <AppTabs {...appTabs} />
      {children}
    </>
  );
}
