import { useCallback, useEffect, useMemo, useRef, type ComponentRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { CameraControls, Grid, Line } from "@react-three/drei";
import { Box3, Plane, Vector2, Vector3, type Object3D, type PerspectiveCamera } from "three";
import {
  DEFAULT_GROUP_COLOR,
  nodeColor,
  type FlowEdge,
  type FlowGroup,
  type FlowNode,
  type Vec3,
} from "../model";
import { currentNode, indexSpans, type TimelineSpan } from "../timeline";
import { flowBounds } from "../layout";
import { useFlowEditor, type FlowEditorStore } from "../editor-store";
import { FlowNodeView, type NodeHandlers } from "./FlowNodeView";
import { FlowEdgeView } from "./FlowEdgeView";
import { GroupFrame } from "./GroupFrame";
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
const GROUP_PREFIX = "group:";
const groupOf = (id: string) =>
  id.startsWith(GROUP_PREFIX) ? id.slice(GROUP_PREFIX.length) : null;

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
    const { clock, timeline, run } = state;
    const live = run?.status === "running";
    // A real run follows the wall clock; playback (and replaying a run) follows the speed.
    clock.time = live
      ? (performance.now() - run.startedAt) / 1000
      : Math.min(timeline.duration, clock.time + delta * state.speed);
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
    if (!live && clock.time >= timeline.duration) state.pause();
  });
  return null;
}

function boundsBox(nodes: FlowNode[]): Box3 {
  const { min, max } = flowBounds({ type: "qori-flow3d", version: 1, nodes, edges: [] });
  return new Box3(
    new Vector3(min[0] - 2.4, min[1] - 0.8, min[2] - 1.4),
    new Vector3(max[0] + 2.4, max[1] + 1, max[2] + 1.4)
  );
}

/** Seeking or stopping while paused must redraw the (on-demand) scene. */
function Invalidator({ store }: { store: FlowEditorStore }) {
  const time = useFlowEditor(store, (s) => s.displayTime);
  const run = useFlowEditor(store, (s) => s.run);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [time, run, invalidate]);
  return null;
}

/** Camera presets: fit on open and on request, perspective or top view, focus a point. */
function CameraRig({
  store,
  controls,
}: {
  store: FlowEditorStore;
  controls: React.RefObject<Controls | null>;
}) {
  const fitRequest = useFlowEditor(store, (s) => s.fitRequest);
  const focusRequest = useFlowEditor(store, (s) => s.focusRequest);
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

  useEffect(() => {
    if (!focusRequest || !controls.current) return;
    const [x, y, z] = focusRequest.point;
    void controls.current.moveTo(x, y, z, true);
  }, [focusRequest, controls]);
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

/** Registers what export needs (canvas, snapshot) while the scene is mounted. */
function CaptureBridge({ store }: { store: FlowEditorStore }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    store.getState().setCapture({
      canvas: gl.domElement,
      snapshot: () => {
        gl.render(scene, camera);
        return gl.domElement.toDataURL("image/png");
      },
    });
    return () => store.getState().setCapture(null);
  }, [store, gl, scene, camera]);
  return null;
}

interface GroupBlock {
  group: FlowGroup;
  node: FlowNode;
  members: FlowNode[];
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
  const selectedNodes = useFlowEditor(store, (s) => s.selectedNodes);
  const hovered = useFlowEditor(store, (s) => s.hovered);
  const connectingFrom = useFlowEditor(store, (s) => s.connectingFrom);
  const run = useFlowEditor(store, (s) => (s.runStale ? null : s.run));
  const clock = store.getState().clock;
  const controls = useRef<Controls | null>(null);
  const { camera, gl } = useThree();

  // ── Groups: collapsed ones become a single block ─────────────────────────
  const { visibleNodes, blocks, frames, displayId } = useMemo(() => {
    const groups = doc.groups ?? [];
    const collapsed = new Set(groups.filter((g) => g.collapsed).map((g) => g.id));
    const byGroup = new Map<string, FlowNode[]>();
    for (const node of doc.nodes) {
      if (node.group) byGroup.set(node.group, [...(byGroup.get(node.group) ?? []), node]);
    }
    const blocks: GroupBlock[] = [];
    const frames: Array<{ group: FlowGroup; members: FlowNode[] }> = [];
    for (const group of groups) {
      const members = byGroup.get(group.id);
      if (!members?.length) continue;
      if (!collapsed.has(group.id)) {
        frames.push({ group, members });
        continue;
      }
      const avg = (i: 0 | 2) => members.reduce((sum, n) => sum + n.position[i], 0) / members.length;
      blocks.push({
        group,
        members,
        node: {
          id: `${GROUP_PREFIX}${group.id}`,
          kind: "action",
          label: group.label || "Grupo",
          color: group.color ?? DEFAULT_GROUP_COLOR,
          position: [avg(0), Math.min(...members.map((n) => n.position[1])), avg(2)],
        },
      });
    }
    const visibleNodes = doc.nodes.filter((n) => !(n.group && collapsed.has(n.group)));
    const displayId = (id: string) => {
      const node = doc.nodes.find((n) => n.id === id);
      return node?.group && collapsed.has(node.group) ? `${GROUP_PREFIX}${node.group}` : id;
    };
    return { visibleNodes, blocks, frames, displayId };
  }, [doc.nodes, doc.groups]);

  const nodeSpans = useMemo(() => {
    const spans = indexSpans(timeline.nodes);
    // A collapsed group runs from its first step's start to its last step's end.
    for (const block of blocks) {
      const own = block.members.flatMap((n) => spans.get(n.id) ?? []);
      if (own.length === 0) continue;
      const span: TimelineSpan = {
        id: block.node.id,
        start: Math.min(...own.map((s) => s.start)),
        end: Math.max(...own.map((s) => s.end)),
      };
      spans.set(block.node.id, span);
    }
    return spans;
  }, [timeline, blocks]);
  const edgeSpans = useMemo(() => indexSpans(timeline.edges), [timeline]);
  const displayNodes = useMemo(
    () => new Map([...visibleNodes, ...blocks.map((b) => b.node)].map((n) => [n.id, n])),
    [visibleNodes, blocks]
  );
  const edges = useMemo(
    () =>
      doc.edges.flatMap((edge) => {
        const from = displayNodes.get(displayId(edge.from));
        const to = displayNodes.get(displayId(edge.to));
        if (!from || !to || from === to) return [];
        return [
          {
            edge,
            curve: edgeCurve(from.position, to.position),
            color: nodeColor(from),
            id: edge.id,
          },
        ];
      }),
    [doc.edges, displayNodes, displayId]
  );
  const taken = useMemo(() => new Set(timeline.edges.map((span) => span.id)), [timeline]);
  const hasRun = timeline.edges.length > 0;
  const failed = useMemo(
    () =>
      new Set(
        run ? Object.values(run.steps).flatMap((s) => (s.status === "error" ? [s.nodeId] : [])) : []
      ),
    [run]
  );
  const selectedSet = useMemo(() => new Set(selectedNodes), [selectedNodes]);

  // ── Dragging nodes / connecting / box selection ───────────────────────────
  const drag = useRef<{
    anchor: Vector3;
    origins: Map<string, Vec3>;
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
        const s = store.getState();
        const groupId = groupOf(node.id);
        if (groupId) {
          s.select({ type: "group", id: groupId });
        } else if (event.ctrlKey || event.metaKey) {
          s.toggleNode(node.id);
          return;
        } else if (s.selectedNodes.includes(node.id)) {
          // Keep the multi-selection, make this one the primary.
          s.selectNodes([...s.selectedNodes.filter((id) => id !== node.id), node.id]);
        } else {
          s.select({ type: "node", id: node.id });
        }
        if (!editable || s.run?.status === "running") return;
        const moving = groupId
          ? s.doc.nodes.filter((n) => n.group === groupId)
          : s.doc.nodes.filter((n) => store.getState().selectedNodes.includes(n.id));
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
          anchor: position,
          origins: new Map(moving.map((n) => [n.id, n.position])),
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
        const free = event.altKey;
        const { anchor } = current;
        // Snap the dragged card, move the rest of the selection by the same amount.
        const delta: Vec3 = current.vertical
          ? [0, Math.max(-2, Math.min(12, free ? next.y : snap(next.y))) - anchor.y, 0]
          : [
              (free ? next.x : snap(next.x)) - anchor.x,
              0,
              (free ? next.z : snap(next.z)) - anchor.z,
            ];
        const positions: Record<string, Vec3> = {};
        for (const [id, origin] of current.origins) {
          positions[id] = [origin[0] + delta[0], origin[1] + delta[1], origin[2] + delta[2]];
        }
        store.getState().moveNodes(positions);
      },
      onPointerUp: (event) => {
        if (!drag.current) return;
        (event.target as Element).releasePointerCapture?.(event.pointerId);
        drag.current = null;
        document.body.style.cursor = "";
        setControlsEnabled(true);
      },
      onDoubleClick: (node) => {
        const groupId = groupOf(node.id);
        if (groupId) {
          store.getState().toggleGroup(groupId);
          return;
        }
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
        store.getState().setHovered(nodeAt(visibleNodes, hit, from)?.id ?? null);
      },
      onConnectEnd: (event) => {
        const state = store.getState();
        const from = state.connectingFrom;
        if (!from) return;
        (event.target as Element).releasePointerCapture?.(event.pointerId);
        const target = connectEnd.current && nodeAt(visibleNodes, connectEnd.current, from);
        if (target) state.connect(from, target.id);
        state.setConnectingFrom(null);
        state.setHovered(null);
        connectEnd.current = null;
        setControlsEnabled(true);
      },
    }),
    [camera, editable, onOpenLink, setControlsEnabled, store, visibleNodes]
  );

  const onSelectEdge = useCallback(
    (event: ThreeEvent<MouseEvent>, edge: FlowEdge) => {
      event.stopPropagation();
      store.getState().select({ type: "edge", id: edge.id });
    },
    [store]
  );
  const onSelectGroup = useCallback(
    (event: ThreeEvent<MouseEvent>, group: FlowGroup) => {
      event.stopPropagation();
      store.getState().select({ type: "group", id: group.id });
    },
    [store]
  );
  const onToggleGroup = useCallback(
    (group: FlowGroup) => store.getState().toggleGroup(group.id),
    [store]
  );
  const isPlaying = useCallback(() => store.getState().playing, [store]);

  // Shift+drag on the background draws a selection box. Listened in the capture
  // phase on the canvas' parent so the camera controls never see the drag.
  const raycaster = useThree((s) => s.raycaster);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const host = gl.domElement.parentElement;
    if (!host || !editable) return;
    const nodeUnder = (x: number, y: number, rect: DOMRect) => {
      raycaster.setFromCamera(
        new Vector2(
          ((x - rect.left) / rect.width) * 2 - 1,
          -((y - rect.top) / rect.height) * 2 + 1
        ),
        camera
      );
      return raycaster.intersectObjects(scene.children, true).some((hit) => {
        for (let o: Object3D | null = hit.object; o; o = o.parent)
          if (o.userData.flowNodeId) return true;
        return false;
      });
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.shiftKey) return;
      const rect = gl.domElement.getBoundingClientRect();
      if (nodeUnder(event.clientX, event.clientY, rect)) return; // Shift+drag a step: height.
      event.stopPropagation();
      event.preventDefault();
      const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const additive = event.ctrlKey || event.metaKey;
      store.getState().setMarquee({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
      store.getState().setInteracting(true);
      const onMove = (move: PointerEvent) => {
        store.getState().setMarquee({
          x0: start.x,
          y0: start.y,
          x1: move.clientX - rect.left,
          y1: move.clientY - rect.top,
        });
      };
      const onUp = (up: PointerEvent) => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        const end = { x: up.clientX - rect.left, y: up.clientY - rect.top };
        const [left, right] = [Math.min(start.x, end.x), Math.max(start.x, end.x)];
        const [top, bottom] = [Math.min(start.y, end.y), Math.max(start.y, end.y)];
        const inside = visibleNodes.filter((node) => {
          const p = new Vector3(...node.position).project(camera);
          if (p.z > 1) return false;
          const x = ((p.x + 1) / 2) * rect.width;
          const y = ((1 - p.y) / 2) * rect.height;
          return x >= left && x <= right && y >= top && y <= bottom;
        });
        const s = store.getState();
        const ids = inside.map((n) => n.id);
        s.selectNodes(additive ? [...s.selectedNodes, ...ids] : ids);
        s.setMarquee(null);
        s.setInteracting(false);
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    };
    host.addEventListener("pointerdown", onDown, true);
    return () => host.removeEventListener("pointerdown", onDown, true);
  }, [gl, camera, raycaster, scene, store, editable, visibleNodes]);

  const connectingNode = connectingFrom ? displayNodes.get(connectingFrom) : undefined;

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
        onChange={() => {
          const target = controls.current?.getTarget(new Vector3());
          if (target) store.getState().setCameraTarget([target.x, target.z]);
        }}
      />
      <CameraRig store={store} controls={controls} />
      <PlaybackDriver store={store} controls={controls} />
      <Invalidator store={store} />
      <CaptureBridge store={store} />

      {frames.map(({ group, members }) => (
        <GroupFrame
          key={group.id}
          group={group}
          members={members}
          theme={theme}
          selected={selection?.type === "group" && selection.id === group.id}
          onSelect={onSelectGroup}
          onToggle={onToggleGroup}
        />
      ))}
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
      {visibleNodes.map((node) => (
        <FlowNodeView
          key={node.id}
          node={node}
          theme={theme}
          selected={selectedSet.has(node.id)}
          highlighted={hovered === node.id}
          editable={editable}
          failed={failed.has(node.id)}
          span={nodeSpans.get(node.id)}
          clock={clock}
          handlers={handlers}
        />
      ))}
      {blocks.map((block) => (
        <FlowNodeView
          key={block.node.id}
          node={block.node}
          theme={theme}
          selected={selection?.type === "group" && selection.id === block.group.id}
          highlighted={hovered === block.node.id}
          editable={false}
          failed={block.members.some((n) => failed.has(n.id))}
          subtitle={`Grupo · ${block.members.length} pasos`}
          span={nodeSpans.get(block.node.id)}
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
