// ---------------------------------------------------------------------------
// Explorer — Shared Types
// All types shared across ExplorerPanel, FileTreeNode, hooks, and utilities.
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
}

export interface FlatNode {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  parentPath: string | null;
  index: number;
}

export type ClipboardOperation = "cut" | "copy";

export type ClipboardState =
  | { op: "cut"; paths: string[] }
  | { op: "copy"; paths: string[] }
  | null;

export interface CreatingState {
  parentPath: string;
  type: "file" | "folder";
}

const SORT_ORDER = {
  TYPE_FIRST: "type-first",
  NAME_ASC: "name-asc",
  NAME_DESC: "name-desc",
} as const;

export type SortOrder = (typeof SORT_ORDER)[keyof typeof SORT_ORDER];
export { SORT_ORDER };

export interface DragData {
  type: "explorer-node";
  path: string;
  isDir: boolean;
  selectedPaths: string[];
}

export interface ExplorerStore {
  sortOrder: SortOrder;
  showDotfiles: boolean;
  setSortOrder: (order: SortOrder) => void;
  setShowDotfiles: (show: boolean) => void;
}

export interface UseKeyboardNavOptions {
  flatNodes: FlatNode[];
  expandedPaths: Set<string>;
  onOpen: (path: string, name: string) => void;
  onStartRename: (path: string) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onToggle: (path: string) => void;
  selectedPaths: Set<string>;
  setSelectedPaths: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface UseFileClipboardReturn {
  clipboardState: ClipboardState;
  cut: (paths: string[]) => void;
  copy: (paths: string[]) => void;
  paste: (targetDir: string) => Promise<void>;
  isCut: (path: string) => boolean;
  clear: () => void;
}
