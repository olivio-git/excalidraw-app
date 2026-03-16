import { createContext, useContext } from "react";

interface TabContextValue {
  tabId: string;
  isActive: boolean;
}

export const TabContext = createContext<TabContextValue | null>(null);

export function useTabContext() {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error("useTabContext must be used within a TabContext.Provider");
  }
  return context;
}
