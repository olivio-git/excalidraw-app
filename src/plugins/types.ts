import type React from "react";
import type { RouteConfig } from "@/core/routing/types";
import type { User } from "@/core/auth/types";
import type { KeybindingDeclaration } from "@/core/keybindings/types";
import type {
  ExcalidrawImperativeAPI,
  BinaryFileData,
  AppState,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export interface PluginCommand {
  id: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
}

export type CommandHandler = () => void | Promise<void>;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies?: string[];
  commands?: PluginCommand[];
}

export interface SidebarFooterActionItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  isActive?: boolean;
}

export interface SidebarFooterAction {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  destructive?: boolean;
  submenu?: SidebarFooterActionItem[];
}

/**
 * Handler used for high-level plugin events (pub/sub between plugins and host).
 * The payload is intentionally untyped to keep the event bus generic.
 */
export type PluginEventHandler = (payload: unknown) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Files sub-API
// ---------------------------------------------------------------------------

export interface FileStat {
  path: string;
  name: string;
  isFile: boolean;
  isDir: boolean;
  size: number;
  mtime: number | null;
}

export interface FileListEntry {
  path: string;
  name: string;
  isDir: boolean;
  size?: number;
  mtime?: number | null;
}

/**
 * File-system operations sub-API exposed through PluginAPI.files.
 */
export interface PluginFilesAPI {
  /** Stat a single path and return normalized metadata. */
  stat(path: string): Promise<FileStat>;
  /** List directory contents. Optionally recursive or including dotfiles. */
  list(
    dirPath: string,
    options?: { recursive?: boolean; showDotfiles?: boolean }
  ): Promise<FileListEntry[]>;
  /** Copy a file or folder. Set overwrite to replace existing destinations. */
  copy(srcPath: string, destPath: string, options?: { overwrite?: boolean }): Promise<void>;
  /** Move (rename path) a file or folder and update any open tabs. */
  move(srcPath: string, destPath: string): Promise<void>;
  /** Delete a file or folder. Set recursive: true to remove directories. */
  delete(path: string, options?: { recursive?: boolean }): Promise<void>;
  /**
   * Rename a file or folder (within the same parent directory).
   * Returns the new full absolute path.
   */
  rename(oldPath: string, newName: string): Promise<string>;
  /** Create a directory (including parents). */
  createFolder(dirPath: string): Promise<void>;
  /**
   * Create a new file using the registered handler for the extension.
   * Returns the absolute path of the created file.
   */
  createFile(dirPath: string, name: string): Promise<string>;
  /** Read the full text content of a file. */
  readText(path: string): Promise<string>;
  /** Write text content to a file (overwrites). */
  writeText(path: string, content: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Tabs sub-API
// ---------------------------------------------------------------------------

export interface TabInfo {
  id: string;
  title: string;
  filePath?: string;
  isDirty: boolean;
  isPinned: boolean;
  routeId: string;
}

/**
 * Tab-management sub-API exposed through PluginAPI.tabs.
 */
export interface PluginTabsAPI {
  /** Returns the currently active tab, or null if none. */
  getActive(): TabInfo | null;
  /** Returns all open tabs. */
  list(): TabInfo[];
  /** Open a file in a new tab (or focus if already open). */
  open(filePath: string): void;
  /**
   * Close a tab by id.
   * Respects the pinned/closable constraints unless force is true.
   * Returns true if the tab was actually closed.
   */
  close(tabId: string, options?: { force?: boolean }): boolean;
  /**
   * Activate (focus) a tab by id.
   * Returns true if the tab was found.
   */
  activate(tabId: string): boolean;
  /**
   * Save a specific tab (by tabId) or the active tab if omitted.
   * Only works for diagram tabs — returns false for non-diagram tabs.
   */
  save(tabId?: string): Promise<boolean>;
  /** Save all dirty diagram tabs. Returns a summary of how many succeeded or failed. */
  saveAll(): Promise<{ saved: number; failed: number }>;
  /**
   * Subscribe to active-tab changes.
   * The handler is called immediately with the current tab, then on every change.
   * Returns an unsubscribe function — call it in plugin deactivate().
   */
  onChange(handler: (tab: TabInfo | null) => void): () => void;
}

// ---------------------------------------------------------------------------
// Diagram sub-API
// ---------------------------------------------------------------------------

/**
 * Diagram sub-API exposed through PluginAPI.diagram.
 * Provides imperative access to the active Excalidraw canvas instance.
 */
export interface DiagramPluginAPI {
  getElements(): readonly ExcalidrawElement[];
  addElements(elements: ExcalidrawElement[]): void;
  setElements(elements: ExcalidrawElement[]): void;
  updateScene(sceneData: {
    elements?: ExcalidrawElement[];
    appState?: Partial<AppState>;
    files?: Record<string, BinaryFileData>;
  }): void;
  scrollToContent(): void;
  getApi(instanceId: string): ExcalidrawImperativeAPI | undefined;
  waitForInstance(instanceId: string, timeoutMs?: number): Promise<ExcalidrawImperativeAPI>;
}

// ---------------------------------------------------------------------------
// Document sub-API
// ---------------------------------------------------------------------------

export interface Section {
  id: string;
  heading: string;
  level: number;
  content: string;
}

export interface DocumentAPI {
  createDocument(title: string): Promise<string>;
  openDocument(filePath: string): Promise<void>;
  getContent(filePath: string): string | null;
  getSections(filePath: string): Section[];
  setContent(filePath: string, content: string): Promise<void>;
  appendContent(filePath: string, content: string): Promise<void>;
  insertAfterSection(filePath: string, sectionId: string, content: string): Promise<void>;
  insertAfterHeading(filePath: string, heading: string, content: string): Promise<void>;
  replaceSection(filePath: string, sectionId: string, content: string): Promise<void>;
  deleteSection(filePath: string, sectionId: string): Promise<void>;
  insertDiagram(filePath: string, diagramPath: string, caption?: string): Promise<void>;
  saveDocument(filePath: string): Promise<void>;
  listDocuments(): Promise<string[]>;
  deleteDocument(filePath: string): Promise<void>;
}

/**
 * Public API surface that the host exposes to plugins.
 *
 * This interface is intentionally small and stable; internal PluginManager
 * details stay private and are not exposed through this type.
 */
export interface ActiveTabInfo {
  tabId: string;
  routeId: string;
  title: string;
  path: string;
  instanceId?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginAPI {
  registerRoutes: (routes: RouteConfig[]) => void;
  registerSidebarSection: (section: SidebarSection) => void;
  registerCommand: (commandId: string, handler: CommandHandler) => void;
  getAuthState: () => { isAuthenticated: boolean; user: User | null };
  /** Show a toast notification. */
  notify: (message: string, options?: import("@/shared/lib/notify").NotifyOptions) => void;
  /** Show a confirmation dialog. Returns true if confirmed, false if cancelled. */
  confirm: (options?: import("@/shared/lib/confirm").ConfirmOptions) => Promise<boolean>;
  /**
   * Show a form dialog with one or more input fields.
   * Returns a Record<fieldId, value> if confirmed, null if cancelled.
   */
  prompt: (
    options: import("@/shared/lib/prompt").PromptOptions
  ) => Promise<import("@/shared/lib/prompt").PromptResult>;
  /** Returns the currently active tab, or null if none. */
  getActiveTab: () => ActiveTabInfo | null;
  /** Returns the current workspace directory, or null if not set. */
  getWorkspaceDir: () => string | null;
  /**
   * Register a custom icon for a file extension.
   * Example: api.registerFileIcon("md", MarkdownIcon)
   */
  registerFileIcon: (extension: string, icon: React.ComponentType<{ className?: string }>) => void;
  /**
   * Register a handler for a file extension.
   * Determines which route opens the file and how new files are created.
   * Example: api.registerFileHandler("md", { routeId: "markdown-editor", ... })
   */
  registerFileHandler: (
    extension: string,
    handler: import("@/core/shell/panels/file-handler-registry").FileHandler
  ) => void;
  registerSettingsAction: (action: SidebarFooterAction) => void;
  registerSidebarFooterAction: (action: SidebarFooterAction) => void;

  /**
   * Subscribe to a logical event topic.
   * Topics should be namespaced, for example: "myPlugin.didSomething".
   */
  onEvent: (topic: string, handler: PluginEventHandler) => () => void;

  /**
   * Emit an event on a logical topic.
   * Only payload shape agreed by participants should be relied upon.
   */
  emitEvent: (topic: string, payload?: unknown) => void;

  /**
   * Register a keybinding for this plugin.
   * The binding is tagged with source 'plugin' and automatically unregistered
   * when the plugin is deactivated.
   */
  registerKeybinding: (declaration: KeybindingDeclaration) => void;

  /**
   * Set a context key that can be used in keybinding `when` expressions.
   */
  registerContext: (key: string, value: boolean | string | number) => void;

  /**
   * Open a file in a new tab.
   * Uses the registered file handler for the extension, falls back to the default handler.
   */
  openFile: (filePath: string) => void;

  /**
   * Execute a registered command by ID.
   * Can target built-in commands or commands from other plugins.
   */
  executeCommand: (commandId: string) => Promise<void>;

  /**
   * Subscribe to active tab changes.
   * Handler is called immediately with the current tab, then on every change.
   * Returns an unsubscribe function — call it in plugin deactivate().
   */
  onTabChange: (handler: (tab: ActiveTabInfo | null) => void) => () => void;

  /**
   * Returns the current resolved theme ("light" or "dark").
   */
  getTheme: () => "light" | "dark";

  /**
   * Imperative API for the active Excalidraw diagram canvas.
   * All methods operate on the currently active diagram tab instance.
   */
  diagram: DiagramPluginAPI;

  /**
   * File-system operations sub-API.
   * Provides stat, list, copy, move, delete, rename, createFolder, createFile,
   * readText, and writeText helpers backed by Tauri plugin-fs.
   */
  files: PluginFilesAPI;

  /**
   * Tab-management sub-API.
   * Provides getActive, list, open, close, activate, save, saveAll, and onChange.
   *
   * Note: getActiveTab() and onTabChange() at the root PluginAPI level are
   * kept for backwards compatibility and remain fully functional.
   */
  tabs: PluginTabsAPI;

  /**
   * Document editor sub-API.
   * Provides CRUD operations over markdown documents, section manipulation,
   * and diagram insertion.
   */
  document?: DocumentAPI;
}

export interface SidebarSection {
  id: string;
  label: string;
  order: number;
  icon?: React.ComponentType<{ className?: string }>;
  items: RouteConfig[];
}

export interface Plugin {
  manifest: PluginManifest;
  activate: (api: PluginAPI) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
