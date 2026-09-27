import { installVsix, uninstallExtension, type InstalledExtension } from "./extension-storage";
import { reloadInstalledExtensions } from "./extension-registry";
import { downloadOpenVsxExtension } from "./open-vsx";
import {
  ensureIconThemesInitialized,
  iconThemeKey,
  setActiveIconTheme,
} from "./icon-theme-service";
import {
  colorThemeKey,
  ensureColorThemesInitialized,
  setActiveColorTheme,
} from "./color-theme-service";

/**
 * Install a `.vsix` and activate the first icon theme and the first color theme
 * it contributes, if any.
 */
export async function installVsixExtension(bytes: Uint8Array): Promise<InstalledExtension> {
  await Promise.all([ensureIconThemesInitialized(), ensureColorThemesInitialized()]);
  const extension = await installVsix(bytes);
  await reloadInstalledExtensions();

  const [iconTheme] = extension.iconThemes;
  if (iconTheme) await setActiveIconTheme(iconThemeKey(extension, iconTheme.id));
  const [colorTheme] = extension.colorThemes;
  if (colorTheme) await setActiveColorTheme(colorThemeKey(extension, colorTheme));
  return extension;
}

/** Remove an extension; themes it provided are deactivated by the services. */
export async function uninstallVsixExtension(id: string): Promise<void> {
  await Promise.all([ensureIconThemesInitialized(), ensureColorThemesInitialized()]);
  await uninstallExtension(id);
  await reloadInstalledExtensions();
}

/** Download the latest version from Open VSX and install it (also used to update). */
export async function installFromOpenVsx(
  namespace: string,
  name: string
): Promise<InstalledExtension> {
  return installVsixExtension(await downloadOpenVsxExtension(namespace, name));
}
