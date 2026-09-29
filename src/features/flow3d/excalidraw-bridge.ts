import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { createFileReference, resolveFileReference } from "@/core/shell/services/file-navigation";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { excalidrawToFlow } from "./excalidraw-import";
import { flowToExcalidraw } from "./excalidraw-export";
import { parseFlow, serializeFlow, type FlowDocument } from "./model";

const baseName = (path: string) => (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");

/** Read an `.excalidraw` file and convert it to a flow (source recorded for re-syncing). */
export async function importExcalidrawFile(path: string): Promise<FlowDocument> {
  const text = await readTextFile(path);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("El archivo no es un diagrama de Excalidraw válido.");
  }
  const doc = excalidrawToFlow(
    data,
    baseName(path),
    createFileReference(path, useWorkspaceStore.getState().workspaceDir)
  );
  if (doc.nodes.length === 0)
    throw new Error("El diagrama no tiene formas que convertir en pasos.");
  return doc;
}

/**
 * Re-sync from the drawing: shapes, labels, arrows and positions come from
 * Excalidraw again, while what was edited in 3D (description, links, timing,
 * chosen branch, height) is kept for steps that still exist.
 */
export function mergeImported(current: FlowDocument, imported: FlowDocument): FlowDocument {
  const previous = new Map(current.nodes.map((node) => [node.id, node]));
  return {
    ...current,
    source: imported.source ?? current.source,
    nodes: imported.nodes.map((node) => {
      const old = previous.get(node.id);
      if (!old) return node;
      return {
        ...node,
        kind: old.kind === node.kind ? node.kind : old.kind,
        description: old.description,
        link: old.link,
        duration: old.duration,
        branch: old.branch,
        config: old.config,
        group: old.group,
        color: old.color ?? node.color,
        position: [node.position[0], old.position[1], node.position[2]],
      };
    }),
    edges: imported.edges.map((edge) => {
      const old = current.edges.find((e) => e.from === edge.from && e.to === edge.to);
      return old ? { ...edge, id: old.id, label: edge.label ?? old.label } : edge;
    }),
  };
}

export async function resolveSource(doc: FlowDocument, flowPath: string): Promise<string> {
  if (!doc.source) throw new Error("Este flujo no viene de un diagrama de Excalidraw.");
  const { filePath } = await resolveFileReference(
    doc.source,
    flowPath,
    useWorkspaceStore.getState().workspaceDir
  );
  return filePath;
}

/**
 * Create (or re-sync) `<diagram>.flow3d` next to an Excalidraw file and
 * return its path.
 */
export async function convertExcalidrawToFlowFile(excalidrawPath: string): Promise<string> {
  const target = excalidrawPath.replace(/\.excalidraw$/i, "") + ".flow3d";
  const imported = await importExcalidrawFile(excalidrawPath);
  let doc = imported;
  if (await exists(target)) {
    try {
      doc = mergeImported(parseFlow(await readTextFile(target)), imported);
    } catch {
      doc = imported;
    }
  }
  await writeTextFile(target, serializeFlow(doc));
  return target;
}

/** Path of the drawing a flow exports to: its source, or `<flow>.excalidraw` next to it. */
export async function excalidrawTarget(doc: FlowDocument, flowPath: string): Promise<string> {
  if (doc.source) {
    try {
      return await resolveSource(doc, flowPath);
    } catch {
      // Source moved or deleted: export next to the flow instead.
    }
  }
  return flowPath.replace(/\.flow3d$/i, "") + ".excalidraw";
}

/**
 * Write the flow as an Excalidraw diagram and return the path plus the
 * reference to store as the flow's `source` (so both stay in sync).
 */
export async function exportFlowToExcalidrawFile(
  doc: FlowDocument,
  target: string
): Promise<{ path: string; source: string }> {
  await writeTextFile(target, `${JSON.stringify(flowToExcalidraw(doc), null, 2)}\n`);
  return {
    path: target,
    source: createFileReference(target, useWorkspaceStore.getState().workspaceDir),
  };
}
