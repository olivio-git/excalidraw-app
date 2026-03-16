import { useEffect, useState } from "react";

import type { PluginManifest } from "@/plugins/types";
import { PluginManager } from "@/plugins/plugin-manager";

export interface PluginWithState {
  manifest: PluginManifest;
  isActive: boolean;
}

/**
 * React hook that returns the list of known plugins and their active state.
 * It subscribes to PluginManager events so the data stays up to date when
 * plugins are activated or deactivated.
 */
export function usePluginsState(): PluginWithState[] {
  const [plugins, setPlugins] = useState<PluginWithState[]>([]);

  useEffect(() => {
    const readFromManager = () => {
      const manifests = PluginManager.getManifests();
      setPlugins(
        manifests.map((manifest) => ({
          manifest,
          isActive: PluginManager.isActive(manifest.id),
        }))
      );
    };

    readFromManager();

    const unsubscribe = PluginManager.subscribe((event) => {
      if (
        event.type === "plugin-activated" ||
        event.type === "plugin-deactivated" ||
        event.type === "plugins-changed"
      ) {
        readFromManager();
      }
    });

    return unsubscribe;
  }, []);

  return plugins;
}
