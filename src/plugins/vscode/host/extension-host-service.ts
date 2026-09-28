import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useThemeStore } from "@/stores/themeStore";
import { useLanguageStore } from "@/stores/languageStore";
import { notify } from "@/shared/lib/notify";
import type { InstalledExtension } from "../extension-storage";
import { loadInstalledExtensions, onInstalledExtensionsChanged } from "../extension-registry";
import { effectiveActivationEvents } from "../contributions";
import { setExtensionCommandExecutor } from "../extension-commands";
import { getConfigurationDefaults } from "../contribution-service";
import { onExtensionSettingsChanged, readUserExtensionSettings } from "../extension-settings";
import { HostConnection, createTauriTransport, type HostTransport } from "./host-connection";
import { useExtensionHostStore } from "./host-store";
import { HOST_LOG_CHANNEL, useOutputStore } from "./output-store";
import { registerHostHandlers, resetHostUi } from "./host-handlers";

/**
 * Lifecycle of the extension host process: started when an extension with
 * code (`main`) is installed, restarted when that set changes, and fed with
 * workspace, theme and settings changes. Other features talk to extensions
 * through `extensionHost.request/notify/activateByEvent`.
 */

export interface HostPaths {
  extensionsDir: string;
  storagePath: string;
}

export interface ExtensionHostOptions {
  transport?: () => HostTransport;
  paths?: () => Promise<HostPaths>;
  assetPrefix?: () => Promise<string>;
  isAvailable?: () => boolean;
}

const READY_TIMEOUT_MS = 15000;

async function defaultPaths(): Promise<HostPaths> {
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  const base = await appDataDir();
  return {
    extensionsDir: await join(base, "extensions"),
    storagePath: await join(base, "extension-data"),
  };
}

async function defaultAssetPrefix(): Promise<string> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc("");
}

function codeExtensionsKey(extensions: InstalledExtension[]): string {
  return extensions
    .filter((ext) => ext.main)
    .map((ext) => `${ext.id}@${ext.version}`)
    .sort()
    .join("|");
}

function joinPath(dir: string, name: string): string {
  const separator = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir.replace(/[\\/]$/, "")}${separator}${name}`;
}

export class ExtensionHostService {
  private connection: HostConnection | null = null;
  private transport: HostTransport | null = null;
  private starting: Promise<void> | null = null;
  private extensionsKey = "";
  private cleanup: Array<() => void> = [];
  private stopping = false;
  private readonly options: Required<ExtensionHostOptions>;

  constructor(options: ExtensionHostOptions = {}) {
    this.options = {
      transport: options.transport ?? createTauriTransport,
      paths: options.paths ?? defaultPaths,
      assetPrefix: options.assetPrefix ?? defaultAssetPrefix,
      isAvailable:
        options.isAvailable ??
        (() => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window),
    };
  }

  get isRunning(): boolean {
    return this.connection !== null && useExtensionHostStore.getState().status === "running";
  }

  /** Start if there are extensions with code; resolves once initialized. */
  async start(extensions?: InstalledExtension[]): Promise<void> {
    if (this.starting) return this.starting;
    if (this.connection) return;
    this.starting = this.doStart(extensions ?? (await loadInstalledExtensions())).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(extensions: InstalledExtension[]): Promise<void> {
    const store = useExtensionHostStore.getState();
    const codeExtensions = extensions.filter((ext) => ext.main);
    this.extensionsKey = codeExtensionsKey(extensions);
    if (codeExtensions.length === 0) {
      store.setStatus("idle");
      return;
    }
    if (!this.options.isAvailable()) {
      store.setStatus(
        "unavailable",
        "Las extensiones con código solo se ejecutan en la app de escritorio."
      );
      return;
    }

    store.setStatus("starting");
    store.resetExtensions();
    const output = useOutputStore.getState();
    output.create(HOST_LOG_CHANNEL, "Extension Host");

    const transport = this.options.transport();
    const connection = new HostConnection(transport);
    this.transport = transport;
    this.connection = connection;
    this.stopping = false;

    const ready = new Promise<void>((resolve) => {
      const off = connection.on("ready", () => {
        off();
        resolve();
      });
    });
    this.cleanup.push(
      transport.onLog((line) => useOutputStore.getState().append(HOST_LOG_CHANNEL, `${line}\n`)),
      transport.onExit((code) => this.handleExit(code)),
      ...registerHostHandlers(connection, this)
    );

    try {
      const info = await transport.start();
      store.setRuntime(info.runtime || null);
      await Promise.race([
        ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("El Extension Host no respondió")), READY_TIMEOUT_MS)
        ),
      ]);
      const [paths, assetPrefix, userSettings] = await Promise.all([
        this.options.paths(),
        this.options.assetPrefix(),
        readUserExtensionSettings().catch(() => ({})),
      ]);
      const workspaceDir = useWorkspaceStore.getState().workspaceDir;
      await connection.request("initialize", {
        extensions: codeExtensions.map((ext) => ({
          id: ext.id,
          extensionPath: joinPath(paths.extensionsDir, ext.dir),
          main: ext.main,
          activationEvents: effectiveActivationEvents(ext.activationEvents, ext.contributions),
        })),
        workspaceFolders: workspaceDir ? [workspaceDir] : [],
        settings: { defaults: getConfigurationDefaults(), user: userSettings },
        storagePath: paths.storagePath,
        assetPrefix,
        cspSource: assetPrefix.startsWith("http")
          ? new URL(assetPrefix).origin
          : "asset: http://asset.localhost",
        language: useLanguageStore.getState().language,
        themeKind: useThemeStore.getState().resolvedTheme,
      });
      connection.notify("theme.changed", { kind: useThemeStore.getState().resolvedTheme });
      setExtensionCommandExecutor((command, args) => this.executeCommand(command, args));
      this.watchApp();
      store.setStatus("running");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.append(HOST_LOG_CHANNEL, `[error] ${message}\n`);
      store.setStatus("error", message);
      await this.teardown();
    }
  }

  private watchApp(): void {
    this.cleanup.push(
      useWorkspaceStore.subscribe((state, prev) => {
        if (state.workspaceDir !== prev.workspaceDir) {
          this.notify("workspace.foldersChanged", {
            folders: state.workspaceDir ? [state.workspaceDir] : [],
          });
        }
      }),
      useThemeStore.subscribe((state, prev) => {
        if (state.resolvedTheme !== prev.resolvedTheme) {
          this.notify("theme.changed", { kind: state.resolvedTheme });
        }
      }),
      onExtensionSettingsChanged((user) =>
        this.notify("configuration.changed", { defaults: getConfigurationDefaults(), user })
      )
    );
    const onFocus = () => this.notify("window.state", { focused: true });
    const onBlur = () => this.notify("window.state", { focused: false });
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    this.cleanup.push(() => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    });
  }

  private handleExit(code: number | null): void {
    if (this.stopping) return;
    const message = `El Extension Host terminó inesperadamente (código ${code ?? "?"}).`;
    useOutputStore.getState().append(HOST_LOG_CHANNEL, `[error] ${message}\n`);
    useExtensionHostStore.getState().setStatus("error", message);
    notify("El Extension Host se detuvo", {
      type: "error",
      description: 'Usa "Desarrollador: Reiniciar Extension Host" para volver a iniciarlo.',
    });
    void this.teardown();
  }

  private async teardown(): Promise<void> {
    setExtensionCommandExecutor(null);
    this.cleanup.splice(0).forEach((fn) => fn());
    this.connection?.dispose();
    this.connection = null;
    const transport = this.transport;
    this.transport = null;
    resetHostUi();
    await transport?.stop().catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (!this.connection) return;
    this.stopping = true;
    await Promise.race([
      this.connection.request("shutdown").catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    await this.teardown();
    useExtensionHostStore.getState().setStatus("stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** React to installs/uninstalls: restart only if the code extensions changed. */
  async handleExtensionsChanged(extensions: InstalledExtension[]): Promise<void> {
    if (codeExtensionsKey(extensions) === this.extensionsKey) return;
    await this.stop();
    await this.start(extensions);
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.connection)
      return Promise.reject(new Error("El Extension Host no está en ejecución"));
    return this.connection.request<T>(method, params);
  }

  notify(method: string, params?: unknown): void {
    this.connection?.notify(method, params);
  }

  async activateByEvent(event: string): Promise<void> {
    if (this.starting) await this.starting;
    if (!this.connection) return;
    await this.connection.request("activateByEvent", { event }).catch(() => undefined);
  }

  async executeCommand(command: string, args: unknown[] = []): Promise<unknown> {
    if (this.starting) await this.starting;
    if (!this.connection) {
      notify("El Extension Host no está en ejecución", {
        type: "warning",
        description: useExtensionHostStore.getState().error ?? `No se pudo ejecutar "${command}".`,
      });
      return undefined;
    }
    try {
      return await this.connection.request("executeCommand", { id: command, args });
    } catch (error) {
      notify(`Error al ejecutar "${command}"`, { type: "error", description: String(error) });
      return undefined;
    }
  }
}

export const extensionHost = new ExtensionHostService();

let initialized = false;

/** Start the host (if needed) and follow extension installs. Call once. */
export function initExtensionHost(): void {
  if (initialized) return;
  initialized = true;
  onInstalledExtensionsChanged((extensions) => extensionHost.handleExtensionsChanged(extensions));
  void extensionHost.start().catch((error) => console.error("[exthost] start failed", error));
}
