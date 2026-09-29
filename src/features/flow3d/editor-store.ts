import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  NODE_KINDS,
  newId,
  type FlowDocument,
  type FlowEdge,
  type FlowGroup,
  type FlowNode,
  type FlowNodeKind,
  type StepConfig,
  type Vec3,
} from "./model";
import { applyLayout } from "./layout";
import { buildTimeline, type Timeline } from "./timeline";
import {
  emptyRun,
  executeFlow,
  runTimeline,
  type ExecutorServices,
  type RunOptions,
  type RunState,
} from "./executor";

export type Selection = { type: "node" | "edge" | "group"; id: string } | null;
export type CameraView = "perspective" | "top";
export type FlowMode = "simulate" | "run";

/**
 * Playback clock. Mutable on purpose: the scene advances it every frame
 * without re-rendering React; the UI reads `displayTime` (throttled).
 */
export interface PlaybackClock {
  time: number;
}

/** Copied steps, with the connections between them and their groups. */
export interface FlowClipboard {
  type: "qori-flow3d-clipboard";
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: FlowGroup[];
}

/** What the scene exposes for exporting images and videos. */
export interface SceneCapture {
  canvas: HTMLCanvasElement;
  /** Render now and return a PNG data URL. */
  snapshot: () => string;
}

/** Box selection rectangle, in CSS pixels relative to the canvas. */
export interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FlowEditorState {
  doc: FlowDocument;
  timeline: Timeline;
  selection: Selection;
  /** Every selected node (the primary selection included). */
  selectedNodes: string[];
  hovered: string | null;
  /** Node id an edge is being dragged from. */
  connectingFrom: string | null;
  interacting: boolean;
  playing: boolean;
  speed: number;
  follow: boolean;
  view: CameraView;
  displayTime: number;
  clock: PlaybackClock;
  past: FlowDocument[];
  future: FlowDocument[];
  /** Bumped on every document change (autosave, dirty flag). */
  revision: number;
  /** Bumped to ask the scene to fit the camera to the flow. */
  fitRequest: number;
  /** Ask the scene to move the camera to a point. */
  focusRequest: { point: Vec3; n: number } | null;
  /** Camera target on the ground (minimap), updated by the scene. */
  cameraTarget: [number, number];
  mode: FlowMode;
  /** Last real execution. */
  run: RunState | null;
  /** The flow changed after the last run: its results no longer match the scene. */
  runStale: boolean;
  capture: SceneCapture | null;
  marquee: Marquee | null;

  setDoc: (doc: FlowDocument, options?: { history?: boolean; resetPlayback?: boolean }) => void;
  /** Move a node without recording history (while dragging). */
  moveNode: (id: string, position: Vec3) => void;
  /** Move several nodes at once without recording history. */
  moveNodes: (positions: Record<string, Vec3>) => void;
  /** Record the state before a drag, so undo restores it. */
  beginGesture: () => void;
  updateNode: (id: string, patch: Partial<FlowNode>) => void;
  updateEdge: (id: string, patch: Partial<FlowEdge>) => void;
  addNode: (
    kind: FlowNodeKind,
    options?: { after?: string; position?: Vec3; config?: StepConfig; label?: string }
  ) => string;
  connect: (from: string, to: string) => void;
  removeSelection: () => void;
  select: (selection: Selection) => void;
  /** Add or remove a node from the selection (Ctrl/Shift+click). */
  toggleNode: (id: string) => void;
  selectNodes: (ids: string[]) => void;
  selectAll: () => void;
  copySelection: () => FlowClipboard | null;
  paste: (clipboard: FlowClipboard, offset?: Vec3) => string[];
  duplicateSelection: () => void;
  groupSelection: (label?: string) => string | null;
  updateGroup: (id: string, patch: Partial<FlowGroup>) => void;
  toggleGroup: (id: string) => void;
  ungroup: (id: string) => void;
  /** Lift a whole group to another height (subflows stacked in 3D). */
  setGroupHeight: (id: string, y: number) => void;
  setHovered: (id: string | null) => void;
  setConnectingFrom: (id: string | null) => void;
  setInteracting: (value: boolean) => void;
  layout: () => void;
  undo: () => void;
  redo: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setSpeed: (speed: number) => void;
  setFollow: (follow: boolean) => void;
  setView: (view: CameraView) => void;
  requestFit: () => void;
  focusNode: (id: string) => void;
  focusPoint: (point: Vec3) => void;
  setCameraTarget: (target: [number, number]) => void;
  syncDisplayTime: () => void;
  setMode: (mode: FlowMode) => void;
  /** Execute the flow for real; resolves when it ends. */
  execute: (
    services: ExecutorServices,
    options?: {
      payload?: unknown;
      /** Tests: fake clock and pacing. */
      timing?: Pick<RunOptions, "now" | "sleep" | "edgeDuration" | "minStepDuration">;
    }
  ) => Promise<RunState>;
  cancelRun: () => void;
  clearRun: () => void;
  setCapture: (capture: SceneCapture | null) => void;
  setMarquee: (marquee: Marquee | null) => void;
}

const HISTORY_LIMIT = 100;

export type FlowEditorStore = StoreApi<FlowEditorState>;

/** Clipboard shared by every flow editor of the app (copy in one, paste in another). */
let sharedClipboard: FlowClipboard | null = null;
export const flowClipboard = {
  get: () => sharedClipboard,
  set: (clipboard: FlowClipboard | null) => {
    sharedClipboard = clipboard;
  },
};

export function createFlowEditorStore(initial: FlowDocument): FlowEditorStore {
  let abort: AbortController | null = null;

  return createStore<FlowEditorState>()((set, get) => {
    const timelineFor = (doc: FlowDocument, run: RunState | null, stale: boolean) =>
      run && !stale ? runTimeline(run) : buildTimeline(doc);

    const commit = (doc: FlowDocument, history = true) => {
      const state = get();
      const running = state.run?.status === "running";
      const stale = Boolean(state.run) && !running;
      set({
        doc,
        timeline: running ? state.timeline : timelineFor(doc, state.run, stale || state.runStale),
        runStale: running ? state.runStale : stale || state.runStale,
        past: history ? [...state.past, state.doc].slice(-HISTORY_LIMIT) : state.past,
        future: history ? [] : state.future,
        revision: state.revision + 1,
      });
    };

    const selectionFor = (ids: string[]): Pick<FlowEditorState, "selection" | "selectedNodes"> => ({
      selectedNodes: ids,
      selection: ids.length > 0 ? { type: "node", id: ids[ids.length - 1] } : null,
    });

    return {
      doc: initial,
      timeline: buildTimeline(initial),
      selection: null,
      selectedNodes: [],
      hovered: null,
      connectingFrom: null,
      interacting: false,
      playing: false,
      speed: initial.settings?.speed ?? 1,
      follow: false,
      view: "perspective",
      displayTime: 0,
      clock: { time: 0 },
      past: [],
      future: [],
      revision: 0,
      fitRequest: 0,
      focusRequest: null,
      cameraTarget: [0, 0],
      mode: "simulate",
      run: null,
      runStale: false,
      capture: null,
      marquee: null,

      setDoc: (doc, options = {}) => {
        commit(doc, options.history ?? true);
        const ids = new Set(doc.nodes.map((n) => n.id));
        const { selectedNodes } = get();
        if (selectedNodes.some((id) => !ids.has(id)))
          set(selectionFor(selectedNodes.filter((id) => ids.has(id))));
        if (options.resetPlayback) get().stop();
      },

      moveNode: (id, position) => get().moveNodes({ [id]: position }),

      moveNodes: (positions) => {
        const state = get();
        set({
          doc: {
            ...state.doc,
            nodes: state.doc.nodes.map((n) =>
              positions[n.id] ? { ...n, position: positions[n.id] } : n
            ),
          },
          revision: state.revision + 1,
        });
      },

      beginGesture: () => {
        const state = get();
        set({ past: [...state.past, state.doc].slice(-HISTORY_LIMIT), future: [] });
      },

      updateNode: (id, patch) => {
        const { doc } = get();
        commit({ ...doc, nodes: doc.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
      },

      updateEdge: (id, patch) => {
        const { doc } = get();
        commit({ ...doc, edges: doc.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
      },

      addNode: (kind, options = {}) => {
        const { doc, selection } = get();
        const after = options.after ?? (selection?.type === "node" ? selection.id : undefined);
        const anchor = doc.nodes.find((n) => n.id === after);
        let position: Vec3 = options.position ?? [0, 0, 0];
        if (!options.position) {
          if (anchor) {
            const siblings = doc.edges.filter((e) => e.from === anchor.id).length;
            position = [
              anchor.position[0] + 4.5,
              anchor.position[1],
              anchor.position[2] + siblings * 2.8,
            ];
          } else if (doc.nodes.length > 0) {
            const maxX = Math.max(...doc.nodes.map((n) => n.position[0]));
            position = [maxX + 4.5, 0, 0];
          }
          if (kind === "note") position = [position[0], 2.2, position[2]];
        }
        const node: FlowNode = {
          id: newId("node"),
          kind,
          label: options.label ?? NODE_KINDS[kind].label,
          position,
          config: options.config,
          group: anchor?.group,
        };
        const edges =
          anchor && kind !== "note" && NODE_KINDS[anchor.kind].executes
            ? [...doc.edges, { id: newId("edge"), from: anchor.id, to: node.id }]
            : doc.edges;
        commit({ ...doc, nodes: [...doc.nodes, node], edges });
        set(selectionFor([node.id]));
        return node.id;
      },

      connect: (from, to) => {
        const { doc } = get();
        if (from === to) return;
        if (doc.edges.some((e) => e.from === from && e.to === to)) return;
        commit({ ...doc, edges: [...doc.edges, { id: newId("edge"), from, to }] });
      },

      removeSelection: () => {
        const { doc, selection, selectedNodes } = get();
        if (!selection) return;
        if (selection.type === "node") {
          const gone = new Set(selectedNodes.length > 0 ? selectedNodes : [selection.id]);
          commit({
            ...doc,
            nodes: doc.nodes.filter((n) => !gone.has(n.id)),
            edges: doc.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)),
          });
        } else if (selection.type === "group") {
          get().ungroup(selection.id);
        } else {
          commit({
            ...doc,
            edges: doc.edges.filter((e) => e.id !== selection.id),
            nodes: doc.nodes.map((n) =>
              n.branch === selection.id ? { ...n, branch: undefined } : n
            ),
          });
        }
        set({ selection: null, selectedNodes: [] });
      },

      select: (selection) =>
        set({ selection, selectedNodes: selection?.type === "node" ? [selection.id] : [] }),

      toggleNode: (id) => {
        const { selectedNodes } = get();
        set(
          selectionFor(
            selectedNodes.includes(id)
              ? selectedNodes.filter((n) => n !== id)
              : [...selectedNodes, id]
          )
        );
      },

      selectNodes: (ids) => set(selectionFor([...new Set(ids)])),
      selectAll: () => set(selectionFor(get().doc.nodes.map((n) => n.id))),

      copySelection: () => {
        const { doc, selectedNodes, selection } = get();
        const ids = new Set(
          selection?.type === "group"
            ? doc.nodes.filter((n) => n.group === selection.id).map((n) => n.id)
            : selectedNodes
        );
        if (ids.size === 0) return null;
        const nodes = doc.nodes.filter((n) => ids.has(n.id));
        const groupIds = new Set(nodes.map((n) => n.group).filter(Boolean));
        const clipboard: FlowClipboard = {
          type: "qori-flow3d-clipboard",
          nodes,
          edges: doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
          groups: (doc.groups ?? []).filter((g) => groupIds.has(g.id)),
        };
        sharedClipboard = clipboard;
        return clipboard;
      },

      paste: (clipboard, offset = [1.5, 0, 1.5]) => {
        const { doc } = get();
        if (clipboard.nodes.length === 0) return [];
        const nodeIds = new Map(clipboard.nodes.map((n) => [n.id, newId("node")]));
        const groupIds = new Map(clipboard.groups.map((g) => [g.id, newId("group")]));
        const nodes = clipboard.nodes.map((n) => ({
          ...n,
          id: nodeIds.get(n.id)!,
          position: [
            n.position[0] + offset[0],
            n.position[1] + offset[1],
            n.position[2] + offset[2],
          ] as Vec3,
          group: n.group ? groupIds.get(n.group) : undefined,
          branch: undefined,
        }));
        const edges = clipboard.edges.flatMap((e) => {
          const from = nodeIds.get(e.from);
          const to = nodeIds.get(e.to);
          return from && to ? [{ ...e, id: newId("edge"), from, to }] : [];
        });
        const groups = clipboard.groups.map((g) => ({ ...g, id: groupIds.get(g.id)! }));
        commit({
          ...doc,
          nodes: [...doc.nodes, ...nodes],
          edges: [...doc.edges, ...edges],
          groups: groups.length > 0 ? [...(doc.groups ?? []), ...groups] : doc.groups,
        });
        const ids = nodes.map((n) => n.id);
        set(selectionFor(ids));
        return ids;
      },

      duplicateSelection: () => {
        const clipboard = get().copySelection();
        if (clipboard) get().paste(clipboard);
      },

      groupSelection: (label = "Grupo") => {
        const { doc, selectedNodes } = get();
        if (selectedNodes.length === 0) return null;
        const id = newId("group");
        const ids = new Set(selectedNodes);
        commit({
          ...doc,
          groups: [...(doc.groups ?? []), { id, label }],
          nodes: doc.nodes.map((n) => (ids.has(n.id) ? { ...n, group: id } : n)),
        });
        set({ selection: { type: "group", id }, selectedNodes: [] });
        return id;
      },

      updateGroup: (id, patch) => {
        const { doc } = get();
        commit({
          ...doc,
          groups: (doc.groups ?? []).map((g) => (g.id === id ? { ...g, ...patch } : g)),
        });
      },

      toggleGroup: (id) => {
        const group = get().doc.groups?.find((g) => g.id === id);
        if (group) get().updateGroup(id, { collapsed: group.collapsed ? undefined : true });
      },

      ungroup: (id) => {
        const { doc, selection } = get();
        const groups = (doc.groups ?? []).filter((g) => g.id !== id);
        commit({
          ...doc,
          groups: groups.length > 0 ? groups : undefined,
          nodes: doc.nodes.map((n) => (n.group === id ? { ...n, group: undefined } : n)),
        });
        if (selection?.type === "group" && selection.id === id) set({ selection: null });
      },

      setGroupHeight: (id, y) => {
        const { doc } = get();
        const members = doc.nodes.filter((n) => n.group === id);
        if (members.length === 0) return;
        const base = Math.min(...members.map((n) => n.position[1]));
        const delta = y - base;
        if (Math.abs(delta) < 1e-6) return;
        commit({
          ...doc,
          nodes: doc.nodes.map((n) =>
            n.group === id
              ? { ...n, position: [n.position[0], n.position[1] + delta, n.position[2]] as Vec3 }
              : n
          ),
        });
      },

      setHovered: (hovered) => {
        if (get().hovered !== hovered) set({ hovered });
      },
      setConnectingFrom: (connectingFrom) => set({ connectingFrom }),
      setInteracting: (interacting) => set({ interacting }),

      layout: () => {
        commit(applyLayout(get().doc));
        get().requestFit();
      },

      undo: () => {
        const { past, future, doc, revision, run, runStale } = get();
        const previous = past[past.length - 1];
        if (!previous) return;
        const stale = runStale || Boolean(run && run.status !== "running");
        set({
          doc: previous,
          timeline: timelineFor(previous, run, stale),
          runStale: stale,
          past: past.slice(0, -1),
          future: [doc, ...future],
          revision: revision + 1,
          selection: null,
          selectedNodes: [],
        });
      },

      redo: () => {
        const { past, future, doc, revision, run, runStale } = get();
        const next = future[0];
        if (!next) return;
        const stale = runStale || Boolean(run && run.status !== "running");
        set({
          doc: next,
          timeline: timelineFor(next, run, stale),
          runStale: stale,
          past: [...past, doc],
          future: future.slice(1),
          revision: revision + 1,
          selection: null,
          selectedNodes: [],
        });
      },

      play: () => {
        const { clock, timeline, run } = get();
        if (run?.status === "running") return;
        if (timeline.duration <= 0) return;
        if (clock.time >= timeline.duration) clock.time = 0;
        set({ playing: true });
      },
      pause: () => {
        if (get().run?.status === "running") return;
        set({ playing: false });
        get().syncDisplayTime();
      },
      togglePlay: () => (get().playing ? get().pause() : get().play()),
      stop: () => {
        if (get().run?.status === "running") get().cancelRun();
        get().clock.time = 0;
        set({ playing: false, displayTime: 0 });
      },
      seek: (time) => {
        const { clock, timeline, run } = get();
        if (run?.status === "running") return;
        clock.time = Math.min(Math.max(0, time), timeline.duration);
        set({ displayTime: clock.time });
      },
      setSpeed: (speed) => {
        const { doc } = get();
        set({
          speed,
          doc: { ...doc, settings: { ...doc.settings, speed } },
          revision: get().revision + 1,
        });
      },
      setFollow: (follow) => set({ follow }),
      setView: (view) => set({ view }),
      requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
      focusNode: (id) => {
        const node = get().doc.nodes.find((n) => n.id === id);
        if (!node) return;
        set({ ...selectionFor([id]) });
        get().focusPoint(node.position);
      },
      focusPoint: (point) => set({ focusRequest: { point, n: (get().focusRequest?.n ?? 0) + 1 } }),
      setCameraTarget: (target) => {
        const [x, z] = get().cameraTarget;
        if (Math.abs(x - target[0]) > 0.05 || Math.abs(z - target[1]) > 0.05)
          set({ cameraTarget: target });
      },
      syncDisplayTime: () => {
        const { clock, displayTime } = get();
        if (Math.abs(clock.time - displayTime) > 1e-3) set({ displayTime: clock.time });
      },

      setMode: (mode) => {
        if (get().run?.status === "running") return;
        if (mode === "simulate") {
          get().clearRun();
          set({ mode });
        } else {
          set({ mode });
        }
      },

      execute: async (services, options = {}) => {
        const state = get();
        if (state.run?.status === "running") return state.run;
        const controller = new AbortController();
        abort = controller;
        const now = options.timing?.now ?? (() => performance.now());
        const started = emptyRun(now());
        state.clock.time = 0;
        set({
          mode: "run",
          run: started,
          runStale: false,
          timeline: runTimeline(started),
          playing: true,
          displayTime: 0,
        });
        // A newer run (or clearing the run) replaces `abort`: this run then stops writing.
        const result = await executeFlow(get().doc, {
          services,
          signal: controller.signal,
          payload: options.payload,
          ...options.timing,
          now,
          onUpdate: (run) => {
            if (abort !== controller) return;
            set({ run, timeline: runTimeline(run) });
          },
        });
        if (abort === controller) {
          abort = null;
          const timeline = runTimeline(result);
          set({ run: result, timeline });
          // Let the last packets land, then the scene pauses at the end.
          if (get().clock.time >= timeline.duration) get().pause();
        }
        return result;
      },

      cancelRun: () => abort?.abort(),

      clearRun: () => {
        abort?.abort();
        abort = null;
        const { doc, clock } = get();
        clock.time = 0;
        set({
          run: null,
          runStale: false,
          timeline: buildTimeline(doc),
          playing: false,
          displayTime: 0,
        });
      },

      setCapture: (capture) => set({ capture }),
      setMarquee: (marquee) => set({ marquee }),
    };
  });
}

export function useFlowEditor<T>(
  store: FlowEditorStore,
  selector: (state: FlowEditorState) => T
): T {
  return useStore(store, selector);
}
