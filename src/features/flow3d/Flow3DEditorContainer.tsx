import { useCallback, useEffect, useRef, useState } from "react";
import { exists, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useTabStore } from "@/core/tabs/store/tab-store";
import { registerTabCloseHandler } from "@/core/tabs/tab-lifecycle";
import { contextKeyService } from "@/core/keybindings/context-key-service";
import { createFileReference, openFileReference } from "@/core/shell/services/file-navigation";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { notify } from "@/shared/lib/notify";
import { confirm } from "@/shared/lib/confirm";
import { findStep, parseFlow, serializeFlow, type FlowNode } from "./model";
import { createFlowEditorStore, type FlowEditorStore } from "./editor-store";
import { Flow3DEditor } from "./Flow3DEditor";
import {
  excalidrawTarget,
  exportFlowToExcalidrawFile,
  importExcalidrawFile,
  mergeImported,
  resolveSource,
} from "./excalidraw-bridge";
import { flow3dRegistry } from "./flow3d-registry";
import { sideEffectSteps, STEP_TYPES } from "./executor";
import { createRuntimeServices } from "./runtime-services";
import { recordPlayback, snapshotPng } from "./media-export";

const AUTOSAVE_MS = 700;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; store: FlowEditorStore };

type SaveStatus = "saved" | "saving" | "dirty" | "error";

/** Tab for a `.flow3d` file: loads it, autosaves edits, wires file links. */
export default function Flow3DEditorContainer() {
  const { tabId, isActive, isVisible } = useTabContext();
  // Visible in its editor group (split views show two tabs at once); only hidden tabs stop rendering.
  const visible = isVisible ?? isActive;
  const tab = useTabStore((s) => s.getTab(tabId));
  const filePath = (tab?.instanceId ?? tab?.metadata?.filePath ?? "") as string;
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const savedRevision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useRef<FlowEditorStore | null>(null);
  const [recording, setRecording] = useState(false);
  const navigationAnchor = tab?.metadata?.navigationAnchor as
    | { text: string; id: string }
    | undefined;

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    readTextFile(filePath)
      .then((text) => {
        if (cancelled) return;
        const store = createFlowEditorStore(parseFlow(text));
        storeRef.current = store;
        setLoad({ status: "ready", store });
      })
      .catch((error) => {
        if (!cancelled) setLoad({ status: "error", message: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const store = storeRef.current;
    if (!store) return true;
    const { doc, revision } = store.getState();
    if (revision === savedRevision.current) return true;
    setSaveStatus("saving");
    try {
      await writeTextFile(filePath, serializeFlow(doc));
      savedRevision.current = revision;
      setSaveStatus(store.getState().revision === revision ? "saved" : "dirty");
      return true;
    } catch (error) {
      setSaveStatus("error");
      notify("No se pudo guardar el flujo", { type: "error", description: String(error) });
      return false;
    }
  }, [filePath]);

  // Autosave after a pause in editing; dragging only saves once it settles.
  useEffect(() => {
    if (load.status !== "ready") return;
    return load.store.subscribe((state, previous) => {
      if (state.revision === previous.revision || state.revision === savedRevision.current) return;
      setSaveStatus("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (load.store.getState().interacting) {
          timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
          return;
        }
        void save();
      }, AUTOSAVE_MS);
    });
  }, [load, save]);

  useEffect(() => {
    const store = useTabStore.getState();
    const current = store.getTab(tabId);
    const dirty = saveStatus === "dirty" || saveStatus === "saving";
    if (current && Boolean(current.metadata?.isDirty) !== dirty) {
      store.updateTab(tabId, { metadata: { ...current.metadata, isDirty: dirty } });
    }
  }, [saveStatus, tabId]);

  useEffect(() => registerTabCloseHandler(tabId, save), [tabId, save]);

  useEffect(() => {
    if (!visible && load.status === "ready") load.store.getState().pause();
  }, [visible, load]);

  useEffect(() => {
    if (!isActive) return;
    contextKeyService.set("flow3dEditorActive", true);
    return () => contextKeyService.set("flow3dEditorActive", false);
  }, [isActive, load]);

  // Save pending edits when the tab unmounts.
  useEffect(() => () => void save(), [save]);

  const onLinkFile = useCallback(async (node: FlowNode) => {
    const workspaceDir = useWorkspaceStore.getState().workspaceDir;
    const path = await openDialog({
      multiple: false,
      defaultPath: workspaceDir ?? undefined,
      filters: [
        {
          name: "Notas, markdown, diagramas y flujos",
          extensions: ["note", "md", "excalidraw", "flow3d"],
        },
      ],
    });
    if (typeof path !== "string" || !storeRef.current) return;
    storeRef.current
      .getState()
      .updateNode(node.id, { link: createFileReference(path, workspaceDir) });
  }, []);

  const onOpenLink = useCallback(
    (node: FlowNode) => {
      if (!node.link) return;
      void openFileReference(node.link, filePath, { beside: true, groupId: tab?.groupId }).catch(
        (error: unknown) => notify(String(error), { type: "error" })
      );
    },
    [filePath, tab?.groupId]
  );

  const onImportExcalidraw = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    const workspaceDir = useWorkspaceStore.getState().workspaceDir;
    const path = await openDialog({
      multiple: false,
      defaultPath: workspaceDir ?? undefined,
      filters: [{ name: "Excalidraw", extensions: ["excalidraw"] }],
    });
    if (typeof path !== "string") return;
    try {
      const imported = await importExcalidrawFile(path);
      const current = store.getState().doc;
      if (
        current.nodes.length > 0 &&
        !(await confirm({
          title: "Reemplazar el flujo",
          description: `El flujo actual se sustituye por los ${imported.nodes.length} pasos del diagrama. Puedes deshacerlo con Ctrl+Z.`,
          confirmLabel: "Reemplazar",
          cancelLabel: "Cancelar",
        }))
      )
        return;
      store
        .getState()
        .setDoc(
          { ...imported, name: current.name ?? imported.name, settings: current.settings },
          { resetPlayback: true }
        );
      store.getState().requestFit();
      notify(
        `Diagrama convertido: ${imported.nodes.length} pasos, ${imported.edges.length} conexiones`,
        { type: "success" }
      );
    } catch (error) {
      notify("No se pudo importar el diagrama", { type: "error", description: String(error) });
    }
  }, []);

  const onSyncSource = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    try {
      const doc = store.getState().doc;
      const imported = await importExcalidrawFile(await resolveSource(doc, filePath));
      store.getState().setDoc(mergeImported(doc, imported), { resetPlayback: true });
      notify("Flujo actualizado desde el diagrama", { type: "success" });
    } catch (error) {
      notify("No se pudo sincronizar con el diagrama", {
        type: "error",
        description: String(error),
      });
    }
  }, [filePath]);

  // Links like `pedidos.flow3d#validar` open the flow on that step.
  useEffect(() => {
    if (!navigationAnchor || load.status !== "ready") return;
    const state = load.store.getState();
    const step = findStep(state.doc, navigationAnchor.text);
    if (step) {
      state.focusNode(step.id);
      const span = state.timeline.nodes.find((s) => s.id === step.id);
      if (span && state.run?.status !== "running") state.seek(span.start);
    } else {
      notify(`No hay ningún paso «${navigationAnchor.text}» en este flujo`, { type: "warning" });
    }
    const current = useTabStore.getState().getTab(tabId);
    if (current?.metadata?.navigationAnchor?.id === navigationAnchor.id)
      useTabStore
        .getState()
        .updateTab(tabId, { metadata: { ...current.metadata, navigationAnchor: undefined } });
  }, [navigationAnchor, load, tabId]);

  const onExecute = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    const doc = store.getState().doc;
    const risky = sideEffectSteps(doc);
    if (risky.length > 0) {
      const lines = risky
        .slice(0, 6)
        .map((node) => `• ${node.label || node.id}: ${STEP_TYPES[node.config!.type].label}`)
        .join("\n");
      const more = risky.length > 6 ? `\n… y ${risky.length - 6} más` : "";
      const ok = await confirm({
        title: "Ejecutar el flujo de verdad",
        description: `Estos pasos hacen cambios fuera del flujo (red, terminal, archivos o IA):\n${lines}${more}`,
        confirmLabel: "Ejecutar",
        cancelLabel: "Cancelar",
      });
      if (!ok) return;
    }
    const run = await store.getState().execute(createRuntimeServices(filePath));
    if (run.status === "error") {
      const failed = Object.values(run.steps).find((s) => s.status === "error");
      const node = doc.nodes.find((n) => n.id === failed?.nodeId);
      notify(`El paso «${node?.label ?? failed?.nodeId}» falló`, {
        type: "error",
        description: failed?.error,
      });
    }
  }, [filePath]);

  const baseName = filePath.replace(/\.flow3d$/i, "");

  const onExportImage = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    try {
      const bytes = snapshotPng(store);
      const target = await saveDialog({
        defaultPath: `${baseName}.png`,
        filters: [{ name: "Imagen PNG", extensions: ["png"] }],
      });
      if (!target) return;
      await writeFile(target, bytes);
      notify("Imagen exportada", { type: "success", description: target });
    } catch (error) {
      notify("No se pudo exportar la imagen", { type: "error", description: String(error) });
    }
  }, [baseName]);

  const onExportVideo = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    const target = await saveDialog({
      defaultPath: `${baseName}.webm`,
      filters: [{ name: "Vídeo WebM", extensions: ["webm"] }],
    });
    if (!target) return;
    setRecording(true);
    try {
      const bytes = await recordPlayback(store);
      await writeFile(target, bytes);
      notify("Vídeo exportado", { type: "success", description: target });
    } catch (error) {
      notify("No se pudo grabar el vídeo", { type: "error", description: String(error) });
    } finally {
      setRecording(false);
    }
  }, [baseName]);

  const onExportExcalidraw = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    try {
      const doc = store.getState().doc;
      const target = await excalidrawTarget(doc, filePath);
      if (
        (await exists(target).catch(() => false)) &&
        !(await confirm({
          title: "Actualizar el diagrama",
          description: `${target.split(/[\\/]/).pop()} se reescribe con los pasos del flujo. Lo dibujado que no sea parte del flujo se pierde.`,
          confirmLabel: "Reescribir",
          cancelLabel: "Cancelar",
        }))
      )
        return;
      const { path, source } = await exportFlowToExcalidrawFile(doc, target);
      if (doc.source !== source) store.getState().setDoc({ ...store.getState().doc, source });
      notify("Diagrama de Excalidraw actualizado", {
        type: "success",
        description: "Edítalo y pulsa sincronizar en el flujo para traer los cambios.",
      });
      void openFileReference(source, filePath, { beside: true, groupId: tab?.groupId }).catch(
        () => undefined
      );
      return path;
    } catch (error) {
      notify("No se pudo exportar a Excalidraw", { type: "error", description: String(error) });
    }
  }, [filePath, tab?.groupId]);

  useEffect(() => {
    if (load.status !== "ready" || !filePath) return;
    return flow3dRegistry.register(filePath, {
      store: load.store,
      save,
      execute: () => {
        load.store.getState().setMode("run");
        void onExecute();
      },
      exportExcalidraw: () => void onExportExcalidraw(),
    });
  }, [load, filePath, save, onExecute, onExportExcalidraw]);

  if (load.status === "loading") {
    return <p className="p-6 text-sm text-muted-foreground">Cargando flujo…</p>;
  }
  if (load.status === "error") {
    return (
      <div className="p-6 text-sm">
        <p className="font-medium text-destructive">No se pudo abrir el flujo</p>
        <p className="mt-1 break-words text-muted-foreground">{load.message}</p>
      </div>
    );
  }
  return (
    <Flow3DEditor
      store={load.store}
      active={visible}
      status={
        saveStatus === "saving"
          ? "Guardando…"
          : saveStatus === "dirty"
            ? "Sin guardar"
            : saveStatus === "error"
              ? "Error al guardar"
              : "Guardado"
      }
      onLinkFile={(node) => void onLinkFile(node)}
      onOpenLink={onOpenLink}
      onImportExcalidraw={() => void onImportExcalidraw()}
      onSyncSource={() => void onSyncSource()}
      onExecute={() => void onExecute()}
      recording={recording}
      exports={{
        image: () => void onExportImage(),
        video: () => void onExportVideo(),
        excalidraw: () => void onExportExcalidraw(),
      }}
    />
  );
}
