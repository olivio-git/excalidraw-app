import { fetch } from "@tauri-apps/plugin-http";

/**
 * Client for the Open VSX registry (https://open-vsx.org), the open extension
 * marketplace used by VSCodium, Theia and others. The Visual Studio Marketplace
 * terms only allow Microsoft products to use it, so we don't.
 *
 * Requests go through the Tauri HTTP plugin (no CORS); the allowed hosts are
 * listed in `src-tauri/capabilities/default.json`.
 */

export const OPEN_VSX_URL = "https://open-vsx.org";

export interface OpenVsxExtension {
  namespace: string;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  downloadCount?: number;
  averageRating?: number;
  verified?: boolean;
  deprecated?: boolean;
  files: {
    download?: string;
    icon?: string;
  };
}

export interface OpenVsxSearchResult {
  offset: number;
  totalSize: number;
  extensions: OpenVsxExtension[];
}

export interface OpenVsxSearchOptions {
  query?: string;
  /** Open VSX category, e.g. "Themes". Omit for all categories. */
  category?: string;
  offset?: number;
  size?: number;
  sortBy?: "relevance" | "downloadCount" | "averageRating" | "timestamp";
}

/** `namespace.name`, lowercased — matches `InstalledExtension.id`. */
export function openVsxExtensionId(ext: Pick<OpenVsxExtension, "namespace" | "name">): string {
  return `${ext.namespace}.${ext.name}`.toLowerCase();
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Open VSX respondió ${response.status} para ${url}`);
  return response.json();
}

function isExtension(value: unknown): value is OpenVsxExtension {
  const ext = value as OpenVsxExtension;
  return (
    typeof ext?.namespace === "string" &&
    typeof ext.name === "string" &&
    typeof ext.version === "string"
  );
}

function normalizeExtension(ext: OpenVsxExtension): OpenVsxExtension {
  return { ...ext, files: ext.files ?? {} };
}

export async function searchOpenVsx(
  options: OpenVsxSearchOptions = {}
): Promise<OpenVsxSearchResult> {
  const params = new URLSearchParams({
    size: String(options.size ?? 24),
    offset: String(options.offset ?? 0),
    sortBy: options.sortBy ?? (options.query ? "relevance" : "downloadCount"),
    sortOrder: "desc",
  });
  if (options.query) params.set("query", options.query);
  if (options.category) params.set("category", options.category);

  const data = (await getJson(`${OPEN_VSX_URL}/api/-/search?${params}`)) as Partial<
    OpenVsxSearchResult & { error?: string }
  >;
  if (data.error) throw new Error(data.error);
  return {
    offset: data.offset ?? 0,
    totalSize: data.totalSize ?? 0,
    extensions: (data.extensions ?? []).filter(isExtension).map(normalizeExtension),
  };
}

/** Latest version metadata of one extension. */
export async function getOpenVsxExtension(
  namespace: string,
  name: string
): Promise<OpenVsxExtension> {
  const data = await getJson(
    `${OPEN_VSX_URL}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`
  );
  if (!isExtension(data)) {
    const error = (data as { error?: string })?.error;
    throw new Error(error ?? `Respuesta inesperada de Open VSX para ${namespace}.${name}`);
  }
  return normalizeExtension(data);
}

/** Download the `.vsix` of the latest version. */
export async function downloadOpenVsxExtension(
  namespace: string,
  name: string
): Promise<Uint8Array> {
  const ext = await getOpenVsxExtension(namespace, name);
  const url = ext.files.download;
  if (!url) throw new Error(`${namespace}.${name} no tiene un .vsix descargable`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar ${url} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Compare dotted versions numerically (`1.10.0` > `1.9.2`); prerelease tags are ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (version: string) =>
    version
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const [left, right] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}
