/**
 * The app's settings as a file, like vim/LazyVim: a commented `config.toml`
 * the user edits, merged over these defaults, then the workspace's own
 * `.qori/config.toml` on top. Unknown keys and wrong types are reported with
 * their path instead of breaking the app; the rest still applies.
 */

export type Translucency = "none" | "native" | "transparent" | "wallpaper";
export type NativeEffect =
  | "auto"
  | "sidebar"
  | "under-window"
  | "hud"
  | "mica"
  | "acrylic"
  | "blur";

export interface AppConfig {
  appearance: {
    theme: "system" | "light" | "dark";
    /** How the window lets the desktop (or a wallpaper) through. */
    translucency: Translucency;
    native_effect: NativeEffect;
    /** Opacity of the editor area when translucent (0.2–1). */
    opacity: number;
    /** Opacity of side bars and panels when translucent (0.1–1). */
    sidebar_opacity: number;
    /** Blur radius in px (wallpaper mode and floating panels). */
    blur: number;
    /** Image behind the window in wallpaper mode (absolute or ~/ path). */
    wallpaper: string;
    /** Extra darkening/lightening over the wallpaper (0–1). */
    wallpaper_dim: number;
    radius: number;
    font_family: string;
    mono_font_family: string;
    font_size: number;
    density: "compact" | "comfortable";
    accent: string;
  };
  editor: {
    /** Editor for .md files: rich blocks or Markdown source (CodeMirror). */
    markdown: "rich" | "source" | "code";
    /** Keys: like any editor, or Vim (modes, motions, :w…). */
    keymap: "default" | "vim";
    /** Markdown text across the whole tab, or a centered reading column. */
    content_width: "full" | "readable";
    font_family: string;
    font_size: number;
    line_height: number;
  };
  notes: {
    /** Show the Notes view (all notes by date, Inkdrop style). */
    enabled: boolean;
    sort: "updated" | "title";
    /** Workspace-relative paths shown first. */
    pinned: string[];
  };
  flow3d: {
    effects: boolean;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  appearance: {
    theme: "system",
    translucency: "none",
    native_effect: "auto",
    opacity: 0.78,
    sidebar_opacity: 0.55,
    blur: 28,
    wallpaper: "",
    wallpaper_dim: 0.35,
    radius: 8,
    font_family: "",
    mono_font_family: "",
    font_size: 14,
    density: "compact",
    accent: "",
  },
  editor: {
    markdown: "rich",
    keymap: "default",
    content_width: "full",
    font_family: "",
    font_size: 0,
    line_height: 0,
  },
  notes: {
    enabled: true,
    sort: "updated",
    pinned: [],
  },
  flow3d: {
    effects: true,
  },
};

type Rule =
  | { type: "string"; oneOf?: readonly string[] }
  | { type: "number"; min: number; max: number }
  | { type: "boolean" }
  | { type: "string[]" };

const str = (oneOf?: readonly string[]): Rule => ({ type: "string", oneOf });
const num = (min: number, max: number): Rule => ({ type: "number", min, max });
const bool: Rule = { type: "boolean" };

export const RULES: { [S in keyof AppConfig]: { [K in keyof AppConfig[S]]: Rule } } = {
  appearance: {
    theme: str(["system", "light", "dark"]),
    translucency: str(["none", "native", "transparent", "wallpaper"]),
    native_effect: str(["auto", "sidebar", "under-window", "hud", "mica", "acrylic", "blur"]),
    opacity: num(0.2, 1),
    sidebar_opacity: num(0.1, 1),
    blur: num(0, 80),
    wallpaper: str(),
    wallpaper_dim: num(0, 1),
    radius: num(0, 24),
    font_family: str(),
    mono_font_family: str(),
    font_size: num(10, 24),
    density: str(["compact", "comfortable"]),
    accent: str(),
  },
  editor: {
    markdown: str(["rich", "source", "code"]),
    keymap: str(["default", "vim"]),
    content_width: str(["full", "readable"]),
    font_family: str(),
    font_size: num(0, 32),
    line_height: num(0, 3),
  },
  notes: {
    enabled: bool,
    sort: str(["updated", "title"]),
    pinned: { type: "string[]" },
  },
  flow3d: {
    effects: bool,
  },
};

export interface ConfigIssue {
  /** Which file it came from. */
  file: string;
  /** `appearance.opacity`, or empty for syntax errors. */
  path: string;
  message: string;
  line?: number;
}

export type PartialConfig = { [S in keyof AppConfig]?: Partial<AppConfig[S]> };

/**
 * Keep what is valid from a parsed file, and describe the rest.
 * Values out of range are clamped (with a warning) rather than dropped.
 */
export function validateConfig(
  raw: unknown,
  file: string
): { config: PartialConfig; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  const config: PartialConfig = {};
  if (!raw || typeof raw !== "object") return { config, issues };
  for (const [section, value] of Object.entries(raw as Record<string, unknown>)) {
    const rules = RULES[section as keyof AppConfig] as Record<string, Rule> | undefined;
    if (!rules) {
      issues.push({ file, path: section, message: `Sección desconocida «${section}»` });
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push({
        file,
        path: section,
        message: `«${section}» debe ser una sección [${section}]`,
      });
      continue;
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const rule = rules[key];
      const path = `${section}.${key}`;
      if (!rule) {
        issues.push({ file, path, message: `Opción desconocida «${path}»` });
        continue;
      }
      if (rule.type === "string") {
        if (typeof item !== "string") {
          issues.push({ file, path, message: `«${path}» debe ser texto` });
        } else if (rule.oneOf && !rule.oneOf.includes(item)) {
          issues.push({
            file,
            path,
            message: `«${path}» debe ser uno de: ${rule.oneOf.join(", ")}`,
          });
        } else out[key] = item;
      } else if (rule.type === "number") {
        if (typeof item !== "number" || !Number.isFinite(item)) {
          issues.push({ file, path, message: `«${path}» debe ser un número` });
        } else {
          const clamped = Math.min(rule.max, Math.max(rule.min, item));
          if (clamped !== item)
            issues.push({
              file,
              path,
              message: `«${path}» va de ${rule.min} a ${rule.max}; se usa ${clamped}`,
            });
          out[key] = clamped;
        }
      } else if (rule.type === "boolean") {
        if (typeof item !== "boolean")
          issues.push({ file, path, message: `«${path}» debe ser true o false` });
        else out[key] = item;
      } else if (!Array.isArray(item) || item.some((v) => typeof v !== "string")) {
        issues.push({ file, path, message: `«${path}» debe ser una lista de textos` });
      } else out[key] = item;
    }
    (config as Record<string, unknown>)[section] = out;
  }
  return { config, issues };
}

/** Defaults, then each layer in order (user file, workspace file…). */
export function mergeConfig(...layers: PartialConfig[]): AppConfig {
  const result = structuredClone(DEFAULT_CONFIG) as unknown as Record<
    string,
    Record<string, unknown>
  >;
  for (const layer of layers) {
    for (const [section, values] of Object.entries(layer)) {
      if (values) Object.assign(result[section], values);
    }
  }
  return result as unknown as AppConfig;
}

/** The file written the first time the user opens their config. */
export const DEFAULT_CONFIG_FILE = `# QoriApp — configuración
#
# Edita y guarda: los cambios se aplican al instante. Borra una línea para
# volver al valor por defecto. Un proyecto puede tener su propio
# .qori/config.toml, que se aplica encima de este.
# Atajos de teclado: keymap.toml · CSS propio: styles.css · Vim: vimrc (misma carpeta).

[appearance]
# theme = "system"          # system | light | dark

# Translucidez de la ventana:
#   none        opaca (por defecto)
#   native      efecto del sistema: vibrancia en macOS, Mica/Acrílico en Windows
#   transparent ventana transparente (Linux: el desenfoque lo pone el compositor,
#               p. ej. KWin «Blur» o reglas de Hyprland)
#   wallpaper   una imagen tuya detrás, desenfocada por la app (todas las plataformas)
# translucency = "none"
# native_effect = "auto"    # auto | sidebar | under-window | hud | mica | acrylic | blur
# opacity = 0.78            # zona del editor (0.2–1)
# sidebar_opacity = 0.55    # barras laterales y paneles (0.1–1)
# blur = 28                 # px
# wallpaper = "~/Imágenes/fondo.jpg"
# wallpaper_dim = 0.35      # oscurece (tema oscuro) o aclara (claro) el fondo

# radius = 8                # esquinas, px
# font_family = "Inter"
# mono_font_family = "JetBrains Mono"
# font_size = 14
# density = "compact"       # compact | comfortable
# accent = "#7c3aed"        # color de acento (CSS)

[editor]
# markdown = "rich"         # rich (bloques) | source (Markdown con formato al escribir) | code (texto plano, como este archivo; vista previa con Ctrl+K V)
# keymap = "default"        # default | vim (modos, movimientos, :w, :q… mapeos en vimrc)
# content_width = "full"    # full (todo el ancho) | readable (columna centrada para leer)
# font_family = "JetBrains Mono"   # vacío: la del tema
# font_size = 15
# line_height = 1.6

[notes]
# enabled = true            # vista «Notas»: todas las notas por fecha
# sort = "updated"          # updated | title
# pinned = ["ideas.md"]     # rutas relativas al proyecto, arriba del todo

[flow3d]
# effects = true            # luz, sombras y brillo en los flujos 3D
`;

export const DEFAULT_KEYMAP_FILE = `# QoriApp — atajos de teclado
#
# Cada [[bind]] asigna una tecla a un comando (búscalos con Ctrl+Shift+P).
# Estos atajos ganan sobre los de la app. Se aplican al guardar.
#
# [[bind]]
# key = "ctrl+alt+n"
# command = "templates.new"
#
# [[bind]]
# key = "ctrl+shift+g"
# command = "knowledgeGraph.open"
# when = ""                 # opcional: contexto (como en VS Code)
`;

export const DEFAULT_VIMRC_FILE = `" QoriApp — vimrc
"
" Se usa con keymap = "vim" en config.toml (editor de código y Markdown).
" Se admite: let mapleader, map/nmap/imap/vmap/xmap y sus versiones noremap.
" Comandos: :w guarda, :q cierra la pestaña, :wq / :x ambas cosas,
" :qori <comando> ejecuta cualquier comando de la app (Ctrl+Shift+P los lista).
" Se aplica al guardar.

" let mapleader = " "

" Salir de modo insertar con jk
" inoremap jk <Esc>

" Guardar y buscar archivos con la tecla líder
" nnoremap <leader>w :w<CR>
" nnoremap <leader>ff :qori workbench.action.openQuickOpen<CR>
" nnoremap <leader>a :qori workbench.action.toggleAgent<CR>
`;

export const DEFAULT_STYLES_FILE = `/* QoriApp — CSS propio
 *
 * Se carga después del tema: aquí puedes cambiar cualquier cosa.
 * Se aplica al guardar. Variables útiles: --background, --foreground,
 * --primary, --sidebar-background (formato "H S% L%"), --radius.
 */

/* Ejemplo: títulos de la lista de notas más grandes
[data-notes-panel] [data-note-title] { font-size: 14px; }
*/
`;
