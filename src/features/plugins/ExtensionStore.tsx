import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Download, Loader2, Palette, RefreshCw, Search } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import { notify } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/utils";
import { useIconThemeState } from "@/plugins/vscode/icon-theme-service";
import { installFromOpenVsx } from "@/plugins/vscode/extension-manager";
import {
  compareVersions,
  openVsxExtensionId,
  searchOpenVsx,
  type OpenVsxExtension,
} from "@/plugins/vscode/open-vsx";

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 350;

const numberFormat = new Intl.NumberFormat(undefined, { notation: "compact" });

function ExtensionIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
        <Palette className="size-3.5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className="size-7 shrink-0 rounded-md object-contain"
      onError={() => setFailed(true)}
    />
  );
}

/** Search and install color/icon themes from the Open VSX registry. */
export function ExtensionStore() {
  const { extensions: installed } = useIconThemeState();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [onlyThemes, setOnlyThemes] = useState(true);
  const [results, setResults] = useState<OpenVsxExtension[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const installedVersions = useMemo(
    () => new Map(installed.map((ext) => [ext.id, ext.version])),
    [installed]
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // New search whenever the query, filter or retry token changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchOpenVsx({
      query: debouncedQuery,
      category: onlyThemes ? "Themes" : undefined,
      size: PAGE_SIZE,
    })
      .then((result) => {
        if (cancelled) return;
        setResults(result.extensions);
        setTotalSize(result.totalSize);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[extension-store] Search failed", err);
        setError(String(err));
        setResults([]);
        setTotalSize(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, onlyThemes, reloadToken]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const result = await searchOpenVsx({
        query: debouncedQuery,
        category: onlyThemes ? "Themes" : undefined,
        size: PAGE_SIZE,
        offset: results.length,
      });
      setResults((current) => [...current, ...result.extensions]);
      setTotalSize(result.totalSize);
    } catch (err) {
      notify("No se pudieron cargar más resultados", { type: "error", description: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const install = async (ext: OpenVsxExtension) => {
    const id = openVsxExtensionId(ext);
    setInstalling(id);
    try {
      const installedExt = await installFromOpenVsx(ext.namespace, ext.name);
      notify(`${installedExt.displayName} v${installedExt.version} instalado y activado`, {
        type: "success",
      });
    } catch (err) {
      console.error("[extension-store] Install failed", err);
      notify(`No se pudo instalar ${ext.displayName ?? ext.name}`, {
        type: "error",
        description: String(err),
      });
    } finally {
      setInstalling(null);
    }
  };

  return (
    <section aria-label="Tienda de extensiones" className="space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Tienda · Open VSX
        </h2>
        <div className="flex-1" />
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar: dracula, material icon…"
            aria-label="Buscar extensiones"
            className="h-7 pl-7 text-xs md:text-xs"
          />
        </div>
        <SegmentedControl
          size="sm"
          ariaLabel="Filtro"
          value={onlyThemes ? "themes" : "all"}
          onChange={(value) => setOnlyThemes(value === "themes")}
          options={[
            { value: "themes", label: "Temas" },
            { value: "all", label: "Todas" },
          ]}
        />
      </div>

      {!onlyThemes && (
        <p className="px-1 text-[11px] text-muted-foreground">
          Por ahora solo se pueden instalar extensiones que aporten temas de color o de iconos.
        </p>
      )}

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-4 text-center text-sm">
          <p className="font-medium">No se pudo conectar con Open VSX</p>
          <p className="max-w-xl break-words text-xs text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => setReloadToken((n) => n + 1)}>
            <RefreshCw className="size-3.5" />
            Reintentar
          </Button>
        </div>
      ) : results.length === 0 && !loading ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No hay resultados para “{debouncedQuery}”.
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {results.map((ext) => {
            const id = openVsxExtensionId(ext);
            const installedVersion = installedVersions.get(id);
            const hasUpdate =
              installedVersion !== undefined && compareVersions(ext.version, installedVersion) > 0;
            const isInstalling = installing === id;
            const label = isInstalling
              ? "Instalando…"
              : hasUpdate
                ? `Actualizar (v${installedVersion} → v${ext.version})`
                : installedVersion
                  ? "Instalado"
                  : "Instalar";
            return (
              <li
                key={id}
                className={cn(
                  "flex items-center gap-3 px-3 py-1.5",
                  ext.deprecated && "opacity-60"
                )}
              >
                <ExtensionIcon src={ext.files.icon} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-medium">
                    <span className="truncate" title={ext.displayName ?? ext.name}>
                      {ext.displayName ?? ext.name}
                    </span>
                    {ext.verified && (
                      <BadgeCheck
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label="Verificado"
                      />
                    )}
                    <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                      {ext.namespace} · v{ext.version}
                      {ext.downloadCount !== undefined &&
                        ` · ${numberFormat.format(ext.downloadCount)}`}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={ext.description}>
                    {ext.description || "Sin descripción."}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant={installedVersion && !hasUpdate ? "ghost" : "outline"}
                  disabled={isInstalling || (installedVersion !== undefined && !hasUpdate)}
                  onClick={() => void install(ext)}
                  aria-label={label}
                  title={label}
                  className="shrink-0"
                >
                  {isInstalling ? <Loader2 className="animate-spin" /> : <Download />}
                  {isInstalling
                    ? "Instalando…"
                    : hasUpdate
                      ? "Actualizar"
                      : installedVersion
                        ? "Instalado"
                        : "Instalar"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {loading && (
        <div className="flex justify-center py-2">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && !error && results.length < totalSize && (
        <div className="flex justify-center">
          <Button size="sm" variant="outline" onClick={() => void loadMore()}>
            Cargar más ({results.length} de {totalSize})
          </Button>
        </div>
      )}
    </section>
  );
}
