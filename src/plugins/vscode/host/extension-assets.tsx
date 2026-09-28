import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Codicon } from "./codicons";
import type { ContainerIcon } from "./view-containers";

/**
 * URLs for files inside installed extensions (icons, media), served by
 * Tauri's asset protocol from `$APPDATA/extensions/<dir>/<path>`.
 */

let extensionsDirPromise: Promise<string> | null = null;

async function extensionsDir(): Promise<string> {
  extensionsDirPromise ??= (async () => {
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    return join(await appDataDir(), "extensions");
  })();
  return extensionsDirPromise;
}

export async function extensionAssetUrl(
  extensionDir: string,
  relativePath: string
): Promise<string> {
  const [{ convertFileSrc }, base] = await Promise.all([
    import("@tauri-apps/api/core"),
    extensionsDir(),
  ]);
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const path = [base, extensionDir, ...relativePath.split("/")].join(separator);
  return convertFileSrc(path);
}

export function useExtensionAssetUrl(extensionDir?: string, relativePath?: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!extensionDir || !relativePath) return;
    let cancelled = false;
    extensionAssetUrl(extensionDir, relativePath)
      .then((value) => !cancelled && setUrl(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [extensionDir, relativePath]);
  return extensionDir && relativePath ? url : null;
}

/**
 * Monochrome icon (activity bar / command icons): the image is used as a
 * mask and painted with the current text color, like VS Code does.
 */
export function ExtensionIcon({
  icon,
  className,
  fallback,
}: {
  icon?: ContainerIcon;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const url = useExtensionAssetUrl(icon?.extensionDir, icon?.path);
  if (icon?.codicon)
    return <Codicon name={icon.codicon} className={cn("text-[16px]", className)} />;
  if (!url) return <>{fallback ?? null}</>;
  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 bg-current", className)}
      style={{
        maskImage: `url("${url}")`,
        WebkitMaskImage: `url("${url}")`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
