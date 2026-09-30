import { create } from "zustand";
import { DEFAULT_CONFIG, type AppConfig, type ConfigIssue } from "./schema";
import type { KeymapBinding } from "./loader";

export interface ConfigFiles {
  dir: string;
  config: string;
  keymap: string;
  styles: string;
  /** `<workspace>/.qori/config.toml`, when a workspace is open. */
  workspace: string | null;
}

interface ConfigState {
  config: AppConfig;
  /** Options set explicitly in a file (`appearance.theme`…): only those override the settings UI. */
  explicit: Set<string>;
  binds: KeymapBinding[];
  styles: string;
  issues: ConfigIssue[];
  files: ConfigFiles | null;
  loaded: boolean;
}

export const useConfigStore = create<ConfigState>()(() => ({
  config: DEFAULT_CONFIG,
  explicit: new Set(),
  binds: [],
  styles: "",
  issues: [],
  files: null,
  loaded: false,
}));
