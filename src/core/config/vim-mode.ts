import { Compartment, Facet, Prec, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";

/**
 * Vim keybindings for the app's text editors (code and Markdown), the same
 * engine Inkdrop uses (@replit/codemirror-vim): pure JavaScript, so it works
 * the same on Windows, macOS and Linux with nothing installed. Turned on with
 * `keymap = "vim"` in config.toml; mappings come from ~/.config/qori/vimrc.
 */

export type EditorKeymap = "default" | "vim";

/** How an editor saves, for `:w`. */
export const editorSaveFacet = Facet.define<() => void, (() => void) | undefined>({
  combine: (values) => values.at(-1),
});

const keymapCompartment = new Compartment();
const views = new Set<EditorView>();
let mode: EditorKeymap = "default";
let current: Extension = [];

const tracker = ViewPlugin.define((view) => {
  views.add(view);
  return { destroy: () => views.delete(view) };
});

/** Add to an editor's extensions: the keymap from config.toml, and `:w` saving it. */
export function editorKeymapExtension(onSave: () => void): Extension {
  return [Prec.highest(keymapCompartment.of(current)), tracker, editorSaveFacet.of(onSave)];
}

export function currentEditorKeymap(): EditorKeymap {
  return mode;
}

type VimApi = (typeof import("@replit/codemirror-vim"))["Vim"];
let vimApi: VimApi | null = null;
let pendingVimrc: VimrcMapping[] = [];

/** Switch every open editor (and the ones opened later) to the keymap. */
export async function setEditorKeymap(next: EditorKeymap): Promise<void> {
  if (next === mode) return;
  mode = next;
  if (next === "vim") {
    const module = await import("@replit/codemirror-vim");
    if (mode !== "vim") return;
    if (!vimApi) {
      vimApi = module.Vim;
      defineExCommands(vimApi);
    }
    applyMappings(vimApi, pendingVimrc);
    current = module.vim({ status: true });
  } else {
    current = [];
  }
  for (const view of views) view.dispatch({ effects: keymapCompartment.reconfigure(current) });
}

function defineExCommands(vim: VimApi): void {
  const save = (view: EditorView | undefined) => view?.state.facet(editorSaveFacet)?.();
  const run = async (command: string) => {
    const { PluginManager } = await import("@/plugins/plugin-manager");
    await PluginManager.executeCommand(command);
  };
  const viewOf = (cm: unknown) => (cm as { cm6?: EditorView }).cm6;
  vim.defineEx("write", "w", (cm) => save(viewOf(cm)));
  vim.defineEx("quit", "q", () => void run("workbench.action.closeActiveTab"));
  vim.defineEx("wq", "wq", (cm) => {
    save(viewOf(cm));
    void run("workbench.action.closeActiveTab");
  });
  vim.defineEx("xit", "x", (cm) => {
    save(viewOf(cm));
    void run("workbench.action.closeActiveTab");
  });
  // Any app command: `:qori workbench.action.openQuickOpen` (or from a mapping).
  vim.defineEx("qori", "qori", (_cm, params) => {
    const command = params.args?.[0];
    if (command) void run(command);
  });
}

// ── vimrc ─────────────────────────────────────────────────────────────────────

export type VimMapMode = "normal" | "insert" | "visual";

export interface VimrcMapping {
  lhs: string;
  rhs: string;
  /** Undefined: normal, visual and operator-pending (like `map`). */
  mode?: VimMapMode;
  recursive: boolean;
}

export interface VimrcProblem {
  line: number;
  message: string;
}

const MAP_COMMANDS: Record<string, { mode?: VimMapMode; recursive: boolean }> = {
  map: { recursive: true },
  nmap: { mode: "normal", recursive: true },
  imap: { mode: "insert", recursive: true },
  vmap: { mode: "visual", recursive: true },
  xmap: { mode: "visual", recursive: true },
  noremap: { recursive: false },
  nnoremap: { mode: "normal", recursive: false },
  inoremap: { mode: "insert", recursive: false },
  vnoremap: { mode: "visual", recursive: false },
  xnoremap: { mode: "visual", recursive: false },
};

const leaderKey = (value: string) => (value === " " ? "<Space>" : value);

/**
 * The part of a vimrc the editor understands: `let mapleader`, the map
 * commands and `"` comments. `<leader>` is replaced by the leader key.
 */
export function parseVimrc(text: string): { mappings: VimrcMapping[]; problems: VimrcProblem[] } {
  const mappings: VimrcMapping[] = [];
  const problems: VimrcProblem[] = [];
  let leader = "\\";
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('"')) return;
    const leaderMatch = line.match(/^let\s+(?:g:)?mapleader\s*=\s*(["'])(.*)\1\s*$/);
    if (leaderMatch) {
      leader = leaderMatch[2] === "\\<Space>" ? " " : leaderMatch[2].replace(/\\\\/g, "\\");
      return;
    }
    const [command, ...rest] = line.split(/\s+/);
    const spec = MAP_COMMANDS[command];
    if (!spec) {
      problems.push({ line: index + 1, message: `vimrc: «${command}» no se admite aquí` });
      return;
    }
    const args = rest.filter((part) => !/^<(silent|buffer|nowait|expr|unique)>$/i.test(part));
    if (args.length < 2) {
      problems.push({ line: index + 1, message: `vimrc: falta la tecla o la acción en «${line}»` });
      return;
    }
    const withLeader = (keys: string) => keys.replace(/<leader>/gi, leaderKey(leader));
    mappings.push({
      lhs: withLeader(args[0]),
      rhs: withLeader(args.slice(1).join(" ")),
      mode: spec.mode,
      recursive: spec.recursive,
    });
  });
  return { mappings, problems };
}

function applyMappings(vim: VimApi, mappings: VimrcMapping[]): void {
  vim.mapclear();
  for (const mapping of mappings) {
    const ctx = mapping.mode as string;
    if (mapping.recursive) vim.map(mapping.lhs, mapping.rhs, ctx);
    else vim.noremap(mapping.lhs, mapping.rhs, ctx);
  }
}

/** Mappings from the vimrc; applied now in Vim mode, or when it is turned on. */
export function setVimrcMappings(mappings: VimrcMapping[]): void {
  pendingVimrc = mappings;
  if (vimApi && mode === "vim") applyMappings(vimApi, mappings);
}
