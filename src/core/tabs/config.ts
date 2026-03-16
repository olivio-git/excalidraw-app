export const TABS_CONFIG = {
  MAX_MOUNTED_TABS: 8,
  MAX_OPEN_TABS: 20,
  DEBUG_MODE: false,
} as const;

export type TabsConfig = typeof TABS_CONFIG;
