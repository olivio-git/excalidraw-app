import { Files, Blocks, Compass, Bot, BookOpen, Link2, Search, NotebookText } from "lucide-react";
import i18n from "@/core/i18n/i18n";
import { viewRegistry, type WorkbenchView } from "@/core/layout/view-registry";
import { ExplorerPanel } from "./panels/ExplorerPanel";
import { PluginsPanel } from "./panels/PluginsPanel";
import { NavigationPanel } from "./panels/NavigationPanel";
import { ReferencesPanel } from "./panels/ReferencesPanel";
import { SearchPanel } from "./panels/SearchPanel";
import { NotesPanel } from "@/features/notes-list/NotesPanel";
import { AIChatPanel } from "@/features/ai-chat/AIChatPanel";
import { LibraryBrowserPanel } from "@/features/library-browser/LibraryBrowserPanel";

const t = (key: string) => () => i18n.t(key, { ns: "common" });

/** Built-in views; they start in the primary side bar (the agent in the secondary one). */
export const BUILTIN_VIEWS: WorkbenchView[] = [
  {
    id: "explorer",
    title: t("panels.explorer"),
    icon: Files,
    component: ExplorerPanel,
    defaultLocation: "primary",
    order: 0,
  },
  {
    id: "notes",
    title: t("notesList.title"),
    icon: NotebookText,
    component: NotesPanel,
    defaultLocation: "primary",
    order: 0.25,
  },
  {
    id: "search",
    title: t("search.title"),
    icon: Search,
    component: SearchPanel,
    defaultLocation: "primary",
    order: 0.5,
  },
  {
    id: "references",
    title: t("connected.references"),
    icon: Link2,
    component: ReferencesPanel,
    defaultLocation: "primary",
    order: 1,
  },
  {
    id: "navigation",
    title: t("panels.navigation"),
    icon: Compass,
    component: NavigationPanel,
    defaultLocation: "primary",
    order: 3,
  },
  {
    id: "ai-chat",
    title: t("panels.aiChat"),
    icon: Bot,
    component: AIChatPanel,
    // Beside the editor, not instead of the explorer: you keep your files in
    // view while talking to the agent (Ctrl+Alt+I).
    defaultLocation: "secondary",
    order: 4,
  },
  {
    id: "library",
    title: t("panels.library"),
    icon: BookOpen,
    component: LibraryBrowserPanel,
    defaultLocation: "primary",
    order: 5,
  },
];

/** Shown only while plugins contribute sidebar sections. */
export const PLUGINS_VIEW: WorkbenchView = {
  id: "plugins",
  title: t("panels.plugins"),
  icon: Blocks,
  component: PluginsPanel,
  defaultLocation: "primary",
  order: 2,
};

let registered = false;

export function registerBuiltinViews(): void {
  if (registered) return;
  registered = true;
  for (const view of BUILTIN_VIEWS) viewRegistry.register(view);
}
