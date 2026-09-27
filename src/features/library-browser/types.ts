export interface ExcalidrawLibraryAuthor {
  name: string;
  url?: string;
}

export interface ExcalidrawLibraryEntry {
  id?: string;
  name: string;
  description: string;
  authors: ExcalidrawLibraryAuthor[];
  source: string;
  preview: string;
  itemNames?: string[];
  version?: number;
  created: string;
  updated: string;
}

export const INSTALL_STATUS = {
  IDLE: "idle",
  LOADING: "loading",
  INSTALLED: "installed",
  ERROR: "error",
} as const;

export type InstallStatus = (typeof INSTALL_STATUS)[keyof typeof INSTALL_STATUS];
