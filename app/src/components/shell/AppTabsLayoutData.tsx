"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AppTabsProps } from "./AppTabs";

const AppTabsLayoutDataContext = createContext<AppTabsProps | null>(null);

export function AppTabsLayoutDataProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AppTabsProps;
}) {
  return (
    <AppTabsLayoutDataContext.Provider value={value}>
      {children}
    </AppTabsLayoutDataContext.Provider>
  );
}

export function useAppTabsLayoutData(): AppTabsProps {
  const value = useContext(AppTabsLayoutDataContext);
  if (!value) throw new Error("AppTabs layout data is unavailable");
  return value;
}
