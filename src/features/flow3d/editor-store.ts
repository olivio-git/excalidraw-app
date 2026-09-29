import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  NODE_KINDS,
  newId,
  type FlowDocument,
  type FlowEdge,
  type FlowNode,
  type FlowNodeKind,
  type Vec3,
} from "./model";
import { applyLayout } from "./layout";
import { buildTimeline, type Timeline } from "./timeline";

export type Selection = { type: "node" | "edge"; id: string } | null;
export type CameraView = "perspective" | "top";

/**
 * Playback clock. Mutable on purpose: the scene advances it every frame
 * without re-rendering React; the UI reads `displayTime` (throttled).
 */
export interface PlaybackClock {
  time: number;
}

export interface FlowEditorState {
  doc: FlowDocument;
  timeline: Timeline;
  selection: Selection;
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

  setDoc: (doc: FlowDocument, options?: { history?: boolean; resetPlayback?: boolean }) => void;
  /** Move a node without recording history (while dragging). */
  moveNode: (id: string, position: Vec3) => void;
  /** Record the state before a drag, so undo restores it. */
  beginGesture: () => void;
  updateNode: (id: string, patch: Partial<FlowNode>) => void;
  updateEdge: (id: string, patch: Partial<FlowEdge>) => void;
  addNode: (kind: FlowNodeKind, options?: { after?: string; position?: Vec3 }) => string;
  connect: (from: string, to: string) => void;
  removeSelection: () => void;
  select: (selection: Selection) => void;
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
  syncDisplayTime: () => void;
}

const HISTORY_LIMIT = 100;

export type FlowEditorStore = StoreApi<FlowEditorState>;

export function createFlowEditorStore(initial: FlowDocument): FlowEditorStore {
  return createStore<FlowEditorState>()((set, get) => {
    const commit = (doc: FlowDocument, history = true) => {
      const state = get();
      set({
        doc,
        timeline: buildTimeline(doc),
        past: history ? [...state.past, state.doc].slice(-HISTORY_LIMIT) : state.past,
        future: history ? [] : state.future,
        revision: state.revision + 1,
      });
    };

    return {
      doc: initial,
      timeline: buildTimeline(initial),
      selection: null,
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

      setDoc: (doc, options = {}) => {
        commit(doc, options.history ?? true);
        if (options.resetPlayback) get().stop();
      },

      moveNode: (id, position) => {
        const state = get();
        set({
          doc: {
            ...state.doc,
            nodes: state.doc.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
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
        const node: FlowNode = { id: newId("node"), kind, label: NODE_KINDS[kind].label, position };
        const edges =
          anchor && kind !== "note" && NODE_KINDS[anchor.kind].executes
            ? [...doc.edges, { id: newId("edge"), from: anchor.id, to: node.id }]
            : doc.edges;
        commit({ ...doc, nodes: [...doc.nodes, node], edges });
        set({ selection: { type: "node", id: node.id } });
        return node.id;
      },

      connect: (from, to) => {
        const { doc } = get();
        if (from === to) return;
        if (doc.edges.some((e) => e.from === from && e.to === to)) return;
        commit({ ...doc, edges: [...doc.edges, { id: newId("edge"), from, to }] });
      },

      removeSelection: () => {
        const { doc, selection } = get();
        if (!selection) return;
        if (selection.type === "node") {
          commit({
            ...doc,
            nodes: doc.nodes.filter((n) => n.id !== selection.id),
            edges: doc.edges.filter((e) => e.from !== selection.id && e.to !== selection.id),
          });
        } else {
          commit({
            ...doc,
            edges: doc.edges.filter((e) => e.id !== selection.id),
            nodes: doc.nodes.map((n) =>
              n.branch === selection.id ? { ...n, branch: undefined } : n
            ),
          });
        }
        set({ selection: null });
      },

      select: (selection) => set({ selection }),
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
        const { past, future, doc, revision } = get();
        const previous = past[past.length - 1];
        if (!previous) return;
        set({
          doc: previous,
          timeline: buildTimeline(previous),
          past: past.slice(0, -1),
          future: [doc, ...future],
          revision: revision + 1,
          selection: null,
        });
      },

      redo: () => {
        const { past, future, doc, revision } = get();
        const next = future[0];
        if (!next) return;
        set({
          doc: next,
          timeline: buildTimeline(next),
          past: [...past, doc],
          future: future.slice(1),
          revision: revision + 1,
          selection: null,
        });
      },

      play: () => {
        const { clock, timeline } = get();
        if (timeline.duration <= 0) return;
        if (clock.time >= timeline.duration) clock.time = 0;
        set({ playing: true });
      },
      pause: () => {
        set({ playing: false });
        get().syncDisplayTime();
      },
      togglePlay: () => (get().playing ? get().pause() : get().play()),
      stop: () => {
        get().clock.time = 0;
        set({ playing: false, displayTime: 0 });
      },
      seek: (time) => {
        const { clock, timeline } = get();
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
      syncDisplayTime: () => {
        const { clock, displayTime } = get();
        if (Math.abs(clock.time - displayTime) > 1e-3) set({ displayTime: clock.time });
      },
    };
  });
}

export function useFlowEditor<T>(
  store: FlowEditorStore,
  selector: (state: FlowEditorState) => T
): T {
  return useStore(store, selector);
}
