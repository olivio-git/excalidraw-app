import {
  exists,
  mkdir,
  readTextFile,
  watch,
  writeTextFile,
  type UnwatchFn,
} from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { openFileInWorkbench } from "@/core/shell/services/file-navigation";
import { notify } from "@/shared/lib/notify";
import {
  DEFAULT_CONFIG_FILE,
  DEFAULT_KEYMAP_FILE,
  DEFAULT_STYLES_FILE,
  DEFAULT_VIMRC_FILE,
  mergeConfig,
  validateConfig,
  type ConfigIssue,
  type PartialConfig,
} from "./schema";
import { expandHome, parseToml, validateKeymap } from "./loader";
import { applyAppearance, applyKeymap, applyUserStyles } from "./apply";
import { parseVimrc, setVimrcMappings } from "./vim-mode";
import { useConfigStore, type ConfigFiles } from "./config-store";

/**
 * Settings as files, like vim/LazyVim:
 *   ~/.config/qori/config.toml   options (appearance, editor, notes…)
 *   ~/.config/qori/keymap.toml   keybindings
 *   ~/.config/qori/styles.css    your own CSS
 *   ~/.config/qori/vimrc         Vim mappings (with keymap = "vim")
 *   <project>/.qori/config.toml  per-project options, over the user's
 * Saved changes apply at once; mistakes are reported, never fatal.
 */

let home = "";

export async function configFiles(workspace: string | null): Promise<ConfigFiles> {
  home = home || (await homeDir());
  const dir = await join(home, ".config", "qori");
  return {
    dir,
    config: await join(dir, "config.toml"),
    keymap: await join(dir, "keymap.toml"),
    styles: await join(dir, "styles.css"),
    vimrc: await join(dir, "vimrc"),
    workspace: workspace ? await join(workspace, ".qori", "config.toml") : null,
  };
}

const read = (path: string | null) =>
  path ? readTextFile(path).catch(() => null) : Promise.resolve(null);

const explicitKeys = (config: PartialConfig) =>
  Object.entries(config).flatMap(([section, values]) =>
    Object.keys(values ?? {}).map((key) => `${section}.${key}`)
  );

let lastReported = "";
/** Last valid options of each file, used while it has a syntax error. */
const lastGood = new Map<string, PartialConfig>();

/** Read every file, validate, merge and apply. */
export async function reloadConfig(): Promise<void> {
  const files = await configFiles(useWorkspaceStore.getState().workspaceDir);
  const [userText, keymapText, stylesText, workspaceText, vimrcText] = await Promise.all([
    read(files.config),
    read(files.keymap),
    read(files.styles),
    read(files.workspace),
    read(files.vimrc),
  ]);
  const issues: ConfigIssue[] = [];
  const layer = (text: string | null, file: string): PartialConfig => {
    if (!text) {
      lastGood.delete(file);
      return {};
    }
    const parsed = parseToml(text, file);
    issues.push(...parsed.issues);
    // Half-typed file (syntax error): keep what it said last time, like vim does.
    if (parsed.data === null) return lastGood.get(file) ?? {};
    const valid = validateConfig(parsed.data, file);
    issues.push(...valid.issues);
    lastGood.set(file, valid.config);
    return valid.config;
  };
  const user = layer(userText, files.config);
  const project = files.workspace ? layer(workspaceText, files.workspace) : {};
  const config = mergeConfig(user, project);
  const explicit = new Set([...explicitKeys(user), ...explicitKeys(project)]);

  let binds: ReturnType<typeof validateKeymap>["binds"] = [];
  if (keymapText) {
    const parsed = parseToml(keymapText, files.keymap);
    issues.push(...parsed.issues);
    const valid = validateKeymap(parsed.data, files.keymap);
    issues.push(...valid.issues);
    binds = valid.binds;
  }

  const vimrc = parseVimrc(vimrcText ?? "");
  setVimrcMappings(vimrc.mappings);
  for (const problem of vimrc.problems)
    issues.push({ file: files.vimrc, path: "", message: problem.message, line: problem.line });

  const workspace = useWorkspaceStore.getState().workspaceDir;
  const resolvePath = (path: string) => {
    const expanded = expandHome(path, home);
    return /^([a-zA-Z]:[\\/]|[\\/])/.test(expanded) || !workspace
      ? expanded
      : `${workspace}/${expanded}`;
  };
  const problems = [
    ...(await applyAppearance(config, explicit, resolvePath)),
    ...applyKeymap(binds),
  ];
  applyUserStyles(stylesText ?? "");
  for (const message of problems) issues.push({ file: files.config, path: "", message });

  useConfigStore.setState({
    config,
    explicit,
    binds,
    styles: stylesText ?? "",
    issues,
    files,
    loaded: true,
  });

  // Tell once per distinct set of problems (saving the same broken file twice stays quiet).
  const summary = issues.map((i) => i.message).join("\n");
  if (summary && summary !== lastReported) {
    notify(`Configuración: ${issues.length} ${issues.length === 1 ? "problema" : "problemas"}`, {
      type: "warning",
      description: issues
        .slice(0, 4)
        .map((i) => `${i.file.split(/[\\/]/).pop()}: ${i.message}`)
        .join("\n"),
    });
  }
  lastReported = summary;
}

let stopWatching: Array<UnwatchFn | undefined> = [];
let timer: ReturnType<typeof setTimeout> | undefined;

async function watchFiles(files: ConfigFiles) {
  stopWatching.forEach((stop) => stop?.());
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void reloadConfig(), 150);
  };
  const dirs = [files.dir, files.workspace?.replace(/[\\/]config\.toml$/, "")].filter(
    Boolean
  ) as string[];
  stopWatching = await Promise.all(
    dirs.map((dir) =>
      watch(
        dir,
        (event) => {
          if (typeof event.type === "object" && "access" in event.type) return;
          schedule();
        },
        { recursive: false }
      ).catch(() => undefined)
    )
  );
}

let started = false;

/** Load now, then follow the files and the open workspace. */
export async function startUserConfig(): Promise<void> {
  if (started) return;
  started = true;
  await reloadConfig().catch((error) => console.error("config", error));
  const files = useConfigStore.getState().files;
  if (files) await watchFiles(files);
  let workspace = useWorkspaceStore.getState().workspaceDir;
  useWorkspaceStore.subscribe((state) => {
    if (state.workspaceDir === workspace) return;
    workspace = state.workspaceDir;
    void reloadConfig().then(() => {
      const next = useConfigStore.getState().files;
      if (next) void watchFiles(next);
    });
  });
}

export type ConfigFileKind = "config" | "keymap" | "styles" | "vimrc" | "workspace";

const TEMPLATES: Record<ConfigFileKind, string> = {
  config: DEFAULT_CONFIG_FILE,
  keymap: DEFAULT_KEYMAP_FILE,
  styles: DEFAULT_STYLES_FILE,
  vimrc: DEFAULT_VIMRC_FILE,
  workspace: `# Configuración de este proyecto: se aplica encima de ~/.config/qori/config.toml.\n# Mismas opciones (ver ese archivo).\n\n# [notes]\n# pinned = ["README.md"]\n`,
};

/** Open a config file in the editor, creating it (commented) the first time. */
export async function openConfigFile(kind: ConfigFileKind): Promise<void> {
  const files = await configFiles(useWorkspaceStore.getState().workspaceDir);
  const path = kind === "workspace" ? files.workspace : files[kind];
  if (!path) {
    notify("Abre una carpeta de proyecto primero", { type: "info" });
    return;
  }
  if (!(await exists(path).catch(() => false))) {
    await mkdir(path.replace(/[\\/][^\\/]+$/, ""), { recursive: true }).catch(() => undefined);
    await writeTextFile(path, TEMPLATES[kind]);
    await watchFiles(files);
  }
  openFileInWorkbench(path);
}
