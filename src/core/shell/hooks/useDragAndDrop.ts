import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { join, dirname } from "@tauri-apps/api/path";
import { rename } from "@tauri-apps/plugin-fs";
import { confirm } from "@/shared/lib/confirm";
import { notify } from "@/shared/lib/notify";
import type { DragData } from "@/core/shell/panels/explorer-types";
import { updateTabsAfterMove } from "@/core/shell/panels/explorer-tab-sync";

// Re-export DndContext so ExplorerPanel can use it without importing @dnd-kit/core directly
export { DndContext };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDescendantOrSelf(srcPath: string, destPath: string): boolean {
  return destPath === srcPath || destPath.startsWith(srcPath + "/");
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseDragAndDropReturn {
  draggingPath: string | null;
  overFolderPath: string | null;
  sensors: ReturnType<typeof useSensors>;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (folderId: string | null) => void;
  handleDragEnd: (event: DragEndEvent, onRefresh: () => Promise<void>) => Promise<void>;
  handleDragCancel: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDragAndDrop(): UseDragAndDropReturn {
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [overFolderPath, setOverFolderPath] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    if (data) {
      setDraggingPath(data.path);
    }
  };

  const handleDragOver = (folderId: string | null) => {
    setOverFolderPath(folderId);
  };

  const handleDragEnd = async (event: DragEndEvent, onRefresh: () => Promise<void>) => {
    setDraggingPath(null);
    setOverFolderPath(null);

    const { active, over } = event;
    if (!over) return;

    const srcData = active.data.current as DragData | undefined;
    if (!srcData) return;

    const destDirPath = over.id as string;
    const srcPath = srcData.path;

    // Determine the source's current parent directory
    const srcParent = await dirname(srcPath);

    // Guard: same parent (no-op)
    if (srcParent === destDirPath) return;

    // Guard: drop onto self or descendant
    if (isDescendantOrSelf(srcPath, destDirPath)) return;

    // Paths to move — if multi-selected, move all selected; otherwise just the dragged item
    const pathsToMove =
      srcData.selectedPaths.length > 1 && srcData.selectedPaths.includes(srcPath)
        ? srcData.selectedPaths
        : [srcPath];

    for (const pathToMove of pathsToMove) {
      const name = pathToMove.split("/").pop() ?? pathToMove;
      const newPath = await join(destDirPath, name);

      // Conflict: destination already has file with same name
      const fs = await import("@tauri-apps/plugin-fs");
      let exists: boolean;
      try {
        await fs.stat(newPath);
        exists = true;
      } catch {
        exists = false;
      }

      if (exists) {
        const ok = await confirm({
          title: "Conflicto de nombres",
          description: `Ya existe "${name}" en el destino. ¿Deseas reemplazarlo?`,
          confirmLabel: "Reemplazar",
          variant: "destructive",
        });
        if (!ok) continue;
      }

      try {
        await rename(pathToMove, newPath);
        updateTabsAfterMove(pathToMove, newPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        notify(`Error al mover "${name}": ${msg}`, { type: "error" });
      }
    }

    await onRefresh();
  };

  const handleDragCancel = () => {
    setDraggingPath(null);
    setOverFolderPath(null);
  };

  return {
    draggingPath,
    overFolderPath,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
