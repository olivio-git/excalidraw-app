import type React from "react";

export interface TabInstance {
  id: string;
  routeId: string;
  path: string;
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  isPinned: boolean;
  isClosable: boolean;
  scrollPosition?: number;
  metadata?: Record<string, any>;
  instanceId?: string;
  openedAt: number;
}
