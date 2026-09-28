import { unzipSync, strFromU8 } from "fflate";
import { parseJsonc } from "./jsonc";
import { normalizeRelativePath } from "./paths";

export interface IconThemeContribution {
  id: string;
  label?: string;
  path: string;
}

export interface ColorThemeContribution {
  id?: string;
  label?: string;
  /** `vs` (light), `vs-dark`, `hc-black` or `hc-light`. */
  uiTheme?: string;
  path: string;
}

/** Subset of a VS Code extension `package.json` we currently understand. */
export interface VsCodeExtensionManifest {
  name: string;
  publisher?: string;
  version?: string;
  displayName?: string;
  description?: string;
  /** Marketplace categories, e.g. ["Themes"] or ["Programming Languages", "Debuggers"]. */
  categories?: string[];
  /** Node entry point, run by the extension host. */
  main?: string;
  /** Web-worker entry point (web extensions); not supported. */
  browser?: string;
  activationEvents?: string[];
  engines?: { vscode?: string };
  /** Other extensions this one needs (`publisher.name`). */
  extensionDependencies?: string[];
  contributes?: {
    iconThemes?: IconThemeContribution[];
    themes?: ColorThemeContribution[];
    [point: string]: unknown;
  };
}

export interface VsixPackage {
  /** `publisher.name`, lowercased — the VS Code extension identifier. */
  id: string;
  manifest: VsCodeExtensionManifest;
  /** Files of the extension, keyed by path relative to the extension root. */
  files: Record<string, Uint8Array>;
  /** `package.nls.json` (English strings for `%key%` placeholders), if present. */
  nls: Record<string, unknown>;
}

const EXTENSION_PREFIX = "extension/";

export function getExtensionId(manifest: Pick<VsCodeExtensionManifest, "name" | "publisher">) {
  return `${manifest.publisher ?? "unknown"}.${manifest.name}`.toLowerCase();
}

/**
 * Unpack a `.vsix` archive (a zip with the extension under `extension/`).
 * Entries that would escape the extension root (zip-slip) are rejected.
 */
export function readVsix(bytes: Uint8Array): VsixPackage {
  const archive = unzipSync(bytes);
  const files: Record<string, Uint8Array> = {};

  for (const [entryPath, data] of Object.entries(archive)) {
    if (!entryPath.startsWith(EXTENSION_PREFIX) || entryPath.endsWith("/")) continue;
    const relative = normalizeRelativePath(entryPath.slice(EXTENSION_PREFIX.length));
    if (!relative) throw new Error(`Ruta inválida dentro del VSIX: ${entryPath}`);
    files[relative] = data;
  }

  const packageJson = files["package.json"];
  if (!packageJson) throw new Error("El VSIX no contiene extension/package.json");

  const manifest = parseJsonc<VsCodeExtensionManifest>(strFromU8(packageJson));
  if (!manifest.name) throw new Error("El package.json de la extensión no tiene 'name'");

  let nls: Record<string, unknown> = {};
  const nlsFile = files["package.nls.json"];
  if (nlsFile) {
    try {
      nls = parseJsonc<Record<string, unknown>>(strFromU8(nlsFile));
    } catch {
      // Untranslated `%key%` strings are shown as-is.
    }
  }

  return { id: getExtensionId(manifest), manifest, files, nls };
}
