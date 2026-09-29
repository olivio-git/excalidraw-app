import { useCallback, useEffect, useMemo, useRef, type ComponentRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { CameraControls, Grid, Line } from "@react-three/drei";
import { Box3, Plane, Vector2, Vector3, type PerspectiveCamera } from "three";
import { nodeColor, type FlowEdge, type FlowNode, type Vec3 } from "../model";
import { currentNode, indexSpans } from "../timeline";
import { flowBounds } from "../layout";
import { useFlowEditor, type FlowEditorStore } from "../editor-store";
import { FlowNodeView, type NodeHandlers } from "./FlowNodeView";
import { FlowEdgeView } from "./FlowEdgeView";
import { Packets } from "./Packets";
import { edgeCurve, nodeAt, outPort } from "./geometry";
import { useSceneTheme, type SceneTheme } from "./theme";

type Controls = ComponentRef<typeof CameraControls>;

interface FlowSceneProps {
  store: FlowEditorStore;
  editable: boolean;
  /** Tab visible: when false nothing renders (no GPU work in the background). */
  active?: boolean;
  onOpenLink?: (node: FlowNode) => void;
}

const SNAP = 0.25;
const snap = (value: number) => Math.round(value / SNAP) * SNAP;

/** Advances the playback clock and makes the camera follow the running step. */
function PlaybackDriver({
  store,
  controls,
}: {
  store: FlowEditorStore;
  controls: React.RefObject<Controls | null>;
}) {
  const lastSync = useRef(0);
  const followed = useRef<string | null>(null);
  useFrame((_, rawDelta) => {
    const state = store.getState();
    if (!state.playing) {
      followed.current = null;
      return;
    }
    const delta = Math.min(rawDelta, 0.1);
    const { clock, timeline } = state;
    clock.time = Math.min(timeline.duration, clock.time + delta * state.speed);
    lastSync.current += delta;
    if (lastSync.current > 0.08) {
      lastSync.current = 0;
      state.syncDisplayTime();
    }
    if (state.follow && controls.current) {
      const id = currentNode(timeline, clock.time);
      if (id && id !== followed.current) {
        followed.current = id;
        const node = state.doc.nodes.find((n) => n.id === id);
        if (node)
          void controls.current.moveTo(node.position[0], node.position[1], node.position[2], true);
      }
    }
    if (clock.time >= timeline.duration) state.pause();
  });
  return null;
}

function boundsBox(nodes: FlowNode[]): Box3 {
  const { min, max } = flowBounds({ type: "qori-flow3d", version: 1, nodes, edges: [] });
  return new Box3(
    new Vector3(min[0] - 1.8, min[1] - 0.8, min[2] - 1.2),
    new Vector3(max[0] + 1.8, max[1] + 1, max[2] + 1.2)
  );
}

/** Seeking or stopping while paused must redraw the (on-demand) scene. */
function Invalidator({ store }: { store: FlowEditorStore }) {
  const time = useFlowEditor(store, (s) => s.displayTime);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [time, invalidate]);
  return null;
}

/** Camera presets: fit on open and on request, perspective or top view. */
function CameraRig({
  store,
  controls,
}: {
  store: FlowEditorStore;
  controls: React.RefObject<Controls | null>;
}) {
  const fitRequest = useFlowEditor(store, (s) => s.fitRequest);
  const view = useFlowEditor(store, (s) => s.view);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const first = useRef(true);

  useEffect(() => {
    const cc = controls.current;
    if (!cc || size.width === 0) return;
    const box = boundsBox(store.getState().doc.nodes);
    const center = box.getCenter(new Vector3());
    const extent = box.getSize(new Vector3());
    const smooth = !first.current;
    first.current = false;
    // Distance that fits the flow's width (horizontal FOV) and depth (vertical FOV).
    const vfov = (camera.fov * Math.PI) / 180;
    const aspect = size.width / Math.max(1, size.height);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fitWidth = extent.x / 2 / Math.tan(hfov / 2);
    const fitDepth = (extent.z * 1.4) / 2 / Math.tan(vfov / 2);
    const distance = Math.max(fitWidth, fitDepth, 7) * 1.08;
    const direction =
      view === "top" ? new Vector3(0, 1, 0.0001) : new Vector3(-0.28, 0.72, 0.9).normalize();
    const eye = center.clone().addScaledVector(direction, distance);
    void cc.setLookAt(eye.x, eye.y, eye.z, center.x, center.y, center.z, smooth);
  }, [fitRequest, view, store, controls, camera, size.width, size.height]);
  return null;
}

/** The line that follows the pointer while dragging a new edge. */
function ConnectPreview({ from, end }: { from: Vec3; end: React.RefObject<Vector3 | null> }) {
  const line = useRef<ComponentRef<typeof Line>>(null);
  const start = useMemo(() => outPort(from), [from]);
  useFrame(() => {
    const target = end.current;
    const geometry = line.current?.geometry as unknown as
      | { setPositions?: (p: number[]) => void }
      | undefined;
    if (!target || !geometry?.setPositions) return;
    geometry.setPositions([start.x, start.y, start.z, target.x, target.y, target.z]);
  });
  return (
    <Line
      ref={line}
      points={[start, start.clone()]}
      color="#94a3b8"
      lineWidth={2}
      dashed
      dashSize={0.2}
      gapSize={0.12}
    />
  );
}

function SceneContent({
  store,
  editable,
  onOpenLink,
  theme,
}: FlowSceneProps & { theme: SceneTheme }) {
  const doc = useFlowEditor(store, (s) => s.doc);
  const timeline = useFlowEditor(store, (s) => s.timeline);
  const selection = useFlowEditor(store, (s) => s.selection);
  const hovered = useFlowEditor(store, (s) => s.hovered);
  const connectingFrom = useFlowEditor(store, (s) => s.connectingFrom);
  const clock = store.getState().clock;
  const controls = useRef<Controls | null>(null);
  const { camera } = useThree();

  const nodeSpans = useMemo(() => indexSpans(timeline.nodes), [timeline]);
  const edgeSpans = useMemo(() => indexSpans(timeline.edges), [timeline]);
  const nodesById = useMemo(() => new Map(doc.nodes.map((n) => [n.id, n])), [doc.nodes]);
  const edges = useMemo(
    () =>
      doc.edges.flatMap((edge) => {
        const from = nodesById.get(edge.from);
        const to = nodesById.get(edge.to);
        if (!from || !to) return [];
        return [
          {
            edge,
            curve: edgeCurve(from.position, to.position),
            color: nodeColor(from),
            id: edge.id,
          },
        ];
      }),
    [doc.edges, nodesById]
  );
  const taken = useMemo(() => new Set(timeline.edges.map((span) => span.id)), [timeline]);
  const hasRun = timeline.edges.length > 0;

  // ── Dragging nodes / connecting ───────────────────────────────────────────
  const drag = useRef<{
    id: string;
    plane: Plane;
    offset: Vector3;
    vertical: boolean;
    start: Vector2;
    moved: boolean;
  } | null>(null);
  const connectEnd = useRef<Vector3 | null>(null);

  const setControlsEnabled = useCallback(
    (enabled: boolean) => {
      if (controls.current) controls.current.enabled = enabled;
      store.getState().setInteracting(!enabled);
    },
    [store]
  );

  const handlers = useMemo<NodeHandlers>(
    () => ({
      onPointerDown: (event, node) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        store.getState().select({ type: "node", id: node.id });
        if (!editable) return;
        (event.target as Element).setPointerCapture?.(event.pointerId);
        const position = new Vector3(...node.position);
        const vertical = event.shiftKey;
        let plane: Plane;
        if (vertical) {
          const direction = camera.getWorldDirection(new Vector3()).setY(0).normalize();
          plane = new Plane().setFromNormalAndCoplanarPoint(direction.negate(), position);
        } else {
          plane = new Plane(new Vector3(0, 1, 0), -position.y);
        }
        const hit = event.ray.intersectPlane(plane, new Vector3());
        drag.current = {
          id: node.id,
          plane,
          offset: hit ? position.clone().sub(hit) : new Vector3(),
          vertical,
          start: new Vector2(event.clientX, event.clientY),
          moved: false,
        };
        setControlsEnabled(false);
      },
      onPointerMove: (event) => {
        const current = drag.current;
        if (!current) return;
        const hit = event.ray.intersectPlane(current.plane, new Vector3());
        if (!hit) return;
        if (!current.moved) {
          if (current.start.distanceTo(new Vector2(event.clientX, event.clientY)) < 3) return;
          current.moved = true;
          store.getState().beginGesture();
          document.body.style.cursor = "grabbing";
        }
        const next = hit.add(current.offset);
        const node = store.getState().doc.nodes.find((n) => n.id === current.id);
        if (!node) return;
        const position: Vec3 = current.vertical
          ? [
              node.position[0],
              Math.max(-2, Math.min(12, event.altKey ? next.y : snap(next.y))),
              node.position[2],
            ]
          : [
              event.altKey ? next.x : snap(next.x),
              node.position[1],
              event.altKey ? next.z : snap(next.z),
            ];
        store.getState().moveNode(current.id, position);
      },
      onPointerUp: (event) => {
        if (!drag.current) return;
        (event.target as Element).releasePointerCapture?.(event.pointerId);
        drag.current = null;
        document.body.style.cursor = "";
        setControlsEnabled(true);
      },
      onDoubleClick: (node) => {
        void controls.current?.moveTo(node.position[0], node.position[1], node.position[2], true);
        if (node.link && onOpenLink) onOpenLink(node);
      },
      onHover: (id) => store.getState().setHovered(id),
      onConnectStart: (event, node) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        (event.target as Element).setPointerCapture?.(event.pointerId);
        connectEnd.current = outPort(node.position);
        store.getState().setConnectingFrom(node.id);
        setControlsEnabled(false);
      },
      onConnectMove: (event) => {
        const from = store.getState().connectingFrom;
        if (!from) return;
        const node = store.getState().doc.nodes.find((n) => n.id === from);
        const plane = new Plane(new Vector3(0, 1, 0), -(node?.position[1] ?? 0));
        const hit = event.ray.intersectPlane(plane, new Vector3());
        if (!hit) return;
        connectEnd.current = hit;
        store.getState().setHovered(nodeAt(store.getState().doc.nodes, hit, from)?.id ?? null);
      },
      onConnectEnd: (event) => {
        const state = store.getState();
        const from = state.connectingFrom;
        if (!from) return;
        (event.target as Element).releasePointerCapture?.(event.pointerId);
        const target = connectEnd.current && nodeAt(state.doc.nodes, connectEnd.current, from);
        if (target) state.connect(from, target.id);
        state.setConnectingFrom(null);
        state.setHovered(null);
        connectEnd.current = null;
        setControlsEnabled(true);
      },
    }),
    [camera, editable, onOpenLink, setControlsEnabled, store]
  );

  const onSelectEdge = useCallback(
    (event: ThreeEvent<MouseEvent>, edge: FlowEdge) => {
      event.stopPropagation();
      store.getState().select({ type: "edge", id: edge.id });
    },
    [store]
  );
  const isPlaying = useCallback(() => store.getState().playing, [store]);

  const connectingNode = connectingFrom ? nodesById.get(connectingFrom) : undefined;

  return (
    <>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.background, 40, 110]} />
      <ambientLight intensity={theme.dark ? 0.55 : 0.8} />
      <hemisphereLight
        args={[theme.dark ? "#cbd5e1" : "#ffffff", theme.dark ? "#0f172a" : "#e2e8f0", 0.6]}
      />
      <directionalLight position={[8, 14, 10]} intensity={theme.dark ? 1.1 : 1.3} />
      <directionalLight position={[-10, 6, -8]} intensity={0.35} />
      <Grid
        position={[0, -0.9, 0]}
        infiniteGrid
        cellSize={0.5}
        sectionSize={2.5}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor={theme.grid}
        sectionColor={theme.gridSection}
        fadeDistance={70}
        fadeStrength={1.5}
        followCamera={false}
      />
      <CameraControls
        ref={controls}
        makeDefault
        smoothTime={0.22}
        draggingSmoothTime={0.08}
        minDistance={3}
        maxDistance={120}
        maxPolarAngle={Math.PI * 0.495}
      />
      <CameraRig store={store} controls={controls} />
      <PlaybackDriver store={store} controls={controls} />
      <Invalidator store={store} />

      {edges.map(({ edge, curve, color }) => (
        <FlowEdgeView
          key={edge.id}
          edge={edge}
          curve={curve}
          color={color}
          theme={theme}
          selected={selection?.type === "edge" && selection.id === edge.id}
          dimmed={hasRun && !taken.has(edge.id)}
          span={edgeSpans.get(edge.id)}
          clock={clock}
          playing={isPlaying}
          onSelect={onSelectEdge}
        />
      ))}
      {doc.nodes.map((node) => (
        <FlowNodeView
          key={node.id}
          node={node}
          theme={theme}
          selected={selection?.type === "node" && selection.id === node.id}
          highlighted={hovered === node.id}
          editable={editable}
          span={nodeSpans.get(node.id)}
          clock={clock}
          handlers={handlers}
        />
      ))}
      <Packets key={edges.length} edges={edges} spans={edgeSpans} clock={clock} dark={theme.dark} />
      {connectingNode && <ConnectPreview from={connectingNode.position} end={connectEnd} />}
    </>
  );
}

/**
 * The 3D view of a flow. Renders on demand (only when something changes) and
 * continuously only while playing or interacting, so an idle flow costs no GPU.
 */
export function FlowScene(props: FlowSceneProps) {
  const theme = useSceneTheme();
  const playing = useFlowEditor(props.store, (s) => s.playing);
  const interacting = useFlowEditor(props.store, (s) => s.interacting);
  const active = props.active ?? true;
  const frameloop = !active ? "never" : playing || interacting ? "always" : "demand";

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, 1.75]}
      camera={{ position: [-4, 10, 16], fov: 42, near: 0.1, far: 400 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        // Focusable so keyboard shortcuts work after clicking the scene.
        gl.domElement.tabIndex = 0;
        gl.domElement.style.outline = "none";
      }}
      onPointerMissed={(event) => {
        if (event.button === 0) props.store.getState().select(null);
      }}
      data-flow3d-canvas
    >
      <SceneContent {...props} theme={theme} />
    </Canvas>
  );
}
