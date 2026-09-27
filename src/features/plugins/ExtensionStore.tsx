import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Download, Loader2, Palette, RefreshCw, Search, Store } from "lucide-react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
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
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <Palette className="size-5 text-muted-foreground" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className="size-10 shrink-0 rounded-md object-contain"
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
    <section className="rounded-xl border border-border bg-card/70 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Store className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Tienda de extensiones</h2>
          <span className="text-[11px] text-muted-foreground">Open VSX</span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {[
            { value: true, label: "Temas" },
            { value: false, label: "Todas" },
          ].map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant={onlyThemes === option.value ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setOnlyThemes(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar temas: dracula, material icon, one dark…"
          className="pl-8"
        />
      </div>

      {!onlyThemes && (
        <p className="text-[11px] text-muted-foreground">
          Por ahora solo se pueden instalar extensiones que aporten temas de color o de iconos.
        </p>
      )}

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm">
          <p className="font-medium">No se pudo conectar con Open VSX</p>
          <p className="max-w-xl break-words text-xs text-muted-foreground">{error}</p>
          <Button size="sm" variant="outline" onClick={() => setReloadToken((n) => n + 1)}>
            <RefreshCw className="size-3.5" />
            Reintentar
          </Button>
        </div>
      ) : results.length === 0 && !loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No hay resultados para “{debouncedQuery}”.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {results.map((ext) => {
            const id = openVsxExtensionId(ext);
            const installedVersion = installedVersions.get(id);
            const hasUpdate =
              installedVersion !== undefined && compareVersions(ext.version, installedVersion) > 0;
            const isInstalling = installing === id;
            return (
              <article
                key={id}
                className={cn(
                  "flex gap-3 rounded-lg border border-border/60 p-3",
                  ext.deprecated && "opacity-60"
                )}
              >
                <ExtensionIcon src={ext.files.icon} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <p className="truncate text-sm font-medium" title={ext.displayName ?? ext.name}>
                      {ext.displayName ?? ext.name}
                    </p>
                    {ext.verified && (
                      <BadgeCheck
                        className="size-3.5 shrink-0 text-primary"
                        aria-label="Verificado"
                      />
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {ext.namespace} · v{ext.version}
                    {ext.downloadCount !== undefined &&
                      ` · ${numberFormat.format(ext.downloadCount)} descargas`}
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {ext.description || "Sin descripción."}
                  </p>
                  <div className="mt-1 flex justify-end">
                    <Button
                      size="sm"
                      variant={installedVersion && !hasUpdate ? "secondary" : "default"}
                      disabled={isInstalling || (installedVersion !== undefined && !hasUpdate)}
                      onClick={() => void install(ext)}
                      className="h-7 gap-1.5 text-xs"
                    >
                      {isInstalling ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      {isInstalling
                        ? "Instalando…"
                        : hasUpdate
                          ? `Actualizar (v${installedVersion} → v${ext.version})`
                          : installedVersion
                            ? "Instalado"
                            : "Instalar"}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
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
