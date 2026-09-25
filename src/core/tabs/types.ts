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
  groupId?: EditorGroupId;
}

export const EDITOR_GROUP = { PRIMARY: "primary", SECONDARY: "secondary" } as const;
export type EditorGroupId = (typeof EDITOR_GROUP)[keyof typeof EDITOR_GROUP];
export const SPLIT_DIRECTION = { HORIZONTAL: "horizontal", VERTICAL: "vertical" } as const;
export type SplitDirection = (typeof SPLIT_DIRECTION)[keyof typeof SPLIT_DIRECTION];

export interface NavigationHistory {
  entries: string[];
  index: number;
}

export interface EditorLayoutState {
  activeGroupId: EditorGroupId;
  groupActiveTabIds: Record<EditorGroupId, string | null>;
  navigation: Record<EditorGroupId, NavigationHistory>;
  splitDirection: SplitDirection | null;
  splitRatio: number;
}
