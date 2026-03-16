import { useEffect, useState } from "react";
import { PluginManager } from "@/plugins/plugin-manager";
import type { SidebarSection, SidebarFooterAction } from "@/plugins/types";

/**
 * Hook to get the sidebar sections and footer actions registered by plugins.
 * It subscribes to PluginManager events to ensure the UI updates when plugins
 * are activated or deactivated.
 */
export function usePluginSidebarResources() {
  const [sections, setSections] = useState<SidebarSection[]>([]);
  const [actions, setActions] = useState<SidebarFooterAction[]>([]);

  useEffect(() => {
    const updateResources = () => {
      // We slice() to return a new array reference and trigger re-render
      setSections([...PluginManager.getSidebarSections()]);
      setActions([...PluginManager.getFooterActions()]);
    };

    // Initial load
    updateResources();

    // Subscribe to changes
    const unsubscribe = PluginManager.subscribe((event) => {
      if (
        event.type === "plugin-activated" ||
        event.type === "plugin-deactivated" ||
        event.type === "plugins-changed"
      ) {
        updateResources();
      }
    });

    return unsubscribe;
  }, []);

  return {
    pluginSections: sections,
    pluginFooterActions: actions,
  };
}
