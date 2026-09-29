import { memo, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Outlines, Text } from "@react-three/drei";
import {
  Color,
  Shape,
  ShapeGeometry,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { NODE_KINDS, nodeColor, type FlowNode } from "../model";
import { sampleNode, type TimelineSpan } from "../timeline";
import type { PlaybackClock } from "../editor-store";
import type { SceneTheme } from "./theme";
import { NODE_SIZE, NOTE_SIZE, PORT_OFFSET } from "./geometry";
import { FONT_URL } from "./font";

// Shared geometries: every node reuses them (one GPU buffer each).
const cardGeometry = new RoundedBoxGeometry(
  NODE_SIZE.width,
  NODE_SIZE.height,
  NODE_SIZE.depth,
  4,
  0.14
);
const noteGeometry = new RoundedBoxGeometry(
  NOTE_SIZE.width,
  NOTE_SIZE.height,
  NOTE_SIZE.depth,
  2,
  0.04
);
const ERROR_COLOR = "#ef4444";
const tileGeometry = new RoundedBoxGeometry(0.7, 0.7, 0.14, 3, 0.12);

function roundedRect(width: number, height: number, radius: number): ShapeGeometry {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new Shape()
    .moveTo(x + radius, y)
    .lineTo(x + width - radius, y)
    .quadraticCurveTo(x + width, y, x + width, y + radius)
    .lineTo(x + width, y + height - radius)
    .quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    .lineTo(x + radius, y + height)
    .quadraticCurveTo(x, y + height, x, y + height - radius)
    .lineTo(x, y + radius)
    .quadraticCurveTo(x, y, x + radius, y);
  return new ShapeGeometry(shape, 8);
}
const haloGeometry = roundedRect(NODE_SIZE.width + 0.6, NODE_SIZE.height + 0.6, 0.4);

function KindGlyph({ kind }: { kind: FlowNode["kind"] }) {
  const material = <meshStandardMaterial color="#ffffff" roughness={0.35} metalness={0.1} />;
  switch (kind) {
    case "trigger":
      return (
        <mesh rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.17, 0.3, 3]} />
          {material}
        </mesh>
      );
    case "condition":
      return (
        <mesh>
          <octahedronGeometry args={[0.2]} />
          {material}
        </mesh>
      );
    case "transform":
      return (
        <mesh>
          <torusGeometry args={[0.14, 0.05, 10, 24]} />
          {material}
        </mesh>
      );
    case "ai":
      return (
        <mesh>
          <icosahedronGeometry args={[0.19]} />
          {material}
        </mesh>
      );
    case "output":
      return (
        <mesh>
          <sphereGeometry args={[0.16, 20, 14]} />
          {material}
        </mesh>
      );
    case "note":
      return null;
    default:
      return (
        <mesh rotation={[0.5, 0.7, 0]}>
          <boxGeometry args={[0.24, 0.24, 0.24]} />
          {material}
        </mesh>
      );
  }
}

export interface NodeHandlers {
  onPointerDown: (event: ThreeEvent<PointerEvent>, node: FlowNode) => void;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
  onDoubleClick: (node: FlowNode) => void;
  onHover: (id: string | null) => void;
  onConnectStart: (event: ThreeEvent<PointerEvent>, node: FlowNode) => void;
  onConnectMove: (event: ThreeEvent<PointerEvent>) => void;
  onConnectEnd: (event: ThreeEvent<PointerEvent>) => void;
}

interface FlowNodeViewProps {
  node: FlowNode;
  theme: SceneTheme;
  selected: boolean;
  highlighted: boolean;
  editable: boolean;
  /** The step failed in the last real run. */
  failed?: boolean;
  /** Extra line under the label (collapsed groups: step count). */
  subtitle?: string;
  span: TimelineSpan | undefined;
  clock: PlaybackClock;
  handlers: NodeHandlers;
}

/**
 * One step of the flow: a rounded card with a colored tile and a 3D glyph for
 * its kind, its label, and ports to connect. Playback state (running, done)
 * animates through refs in useFrame: no React renders per frame.
 */
export const FlowNodeView = memo(function FlowNodeView({
  node,
  theme,
  selected,
  highlighted,
  editable,
  failed = false,
  subtitle,
  span,
  clock,
  handlers,
}: FlowNodeViewProps) {
  const lift = useRef<Group>(null);
  const tile = useRef<MeshStandardMaterial>(null);
  const halo = useRef<MeshBasicMaterial>(null);
  const glyph = useRef<Group>(null);
  const badge = useRef<Mesh>(null);
  const errorBadge = useRef<Mesh>(null);
  const color = nodeColor(node);
  const kindColor = useMemo(() => new Color(color), [color]);
  const isNote = node.kind === "note";
  const size = isNote ? NOTE_SIZE : NODE_SIZE;
  const front = size.depth / 2 + 0.005;

  useFrame(({ invalidate }, delta) => {
    if (isNote) return;
    const { phase, progress } = sampleNode(span, clock.time);
    const active = phase === "active";
    const targetLift = active ? 0.3 : 0;
    const group = lift.current;
    if (group) {
      const next = group.position.y + (targetLift - group.position.y) * Math.min(1, delta * 10);
      group.position.y = Math.abs(next - targetLift) < 0.001 ? targetLift : next;
      if (group.position.y !== targetLift) invalidate();
    }
    if (tile.current) {
      tile.current.emissiveIntensity = active
        ? 0.55 + 0.35 * Math.sin(progress * Math.PI * 4)
        : phase === "done"
          ? 0.22
          : 0.06;
    }
    const errored = failed && phase === "done";
    if (halo.current) {
      halo.current.color.set(
        errored ? ERROR_COLOR : active || !selected ? kindColor : theme.primary
      );
      halo.current.opacity = active
        ? 0.28 + 0.12 * Math.sin(progress * Math.PI * 6)
        : errored
          ? 0.32
          : selected
            ? 0.14
            : 0;
    }
    if (glyph.current && active) glyph.current.rotation.y += delta * 3;
    if (badge.current) badge.current.visible = phase === "done" && !failed;
    if (errorBadge.current) errorBadge.current.visible = errored;
  });

  const bodyEvents = {
    onPointerDown: (event: ThreeEvent<PointerEvent>) => handlers.onPointerDown(event, node),
    onPointerMove: handlers.onPointerMove,
    onPointerUp: handlers.onPointerUp,
    onDoubleClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      handlers.onDoubleClick(node);
    },
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      handlers.onHover(node.id);
      document.body.style.cursor = editable ? "grab" : "pointer";
    },
    onPointerOut: () => {
      handlers.onHover(null);
      document.body.style.cursor = "";
    },
  };

  const outline = selected ? theme.primary : failed ? ERROR_COLOR : highlighted ? color : null;

  return (
    <group position={node.position} userData={{ flowNodeId: node.id }}>
      <group ref={lift}>
        {/* Glow behind the card while the step runs. */}
        <mesh geometry={haloGeometry} position={[0, 0, -size.depth / 2 - 0.02]}>
          <meshBasicMaterial
            ref={halo}
            color={kindColor}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        <mesh geometry={isNote ? noteGeometry : cardGeometry} {...bodyEvents}>
          <meshStandardMaterial
            color={isNote ? color : theme.nodeCard}
            emissive={isNote ? color : theme.nodeCard}
            emissiveIntensity={theme.dark ? 0.12 : 0.35}
            roughness={0.55}
            metalness={0.05}
            transparent={isNote}
            opacity={isNote ? 0.85 : 1}
          />
          {outline && <Outlines thickness={selected ? 0.05 : 0.03} color={outline} />}
        </mesh>

        {!isNote && (
          <>
            <mesh geometry={tileGeometry} position={[-0.82, 0, front + 0.02]}>
              <meshStandardMaterial
                ref={tile}
                color={kindColor}
                emissive={kindColor}
                emissiveIntensity={0.06}
                roughness={0.4}
              />
            </mesh>
            <group ref={glyph} position={[-0.82, 0, front + 0.2]}>
              <KindGlyph kind={node.kind} />
            </group>
          </>
        )}

        <Text
          font={FONT_URL}
          position={isNote ? [-size.width / 2 + 0.18, 0.4, front] : [-0.36, 0.1, front]}
          anchorX="left"
          anchorY={isNote ? "top" : "middle"}
          fontSize={isNote ? 0.2 : 0.23}
          maxWidth={isNote ? size.width - 0.36 : 1.6}
          lineHeight={1.15}
          color={isNote ? "#0f172a" : theme.foreground}
        >
          {node.label || " "}
        </Text>
        {isNote ? (
          node.description && (
            <Text
              font={FONT_URL}
              position={[-size.width / 2 + 0.18, 0.08, front]}
              anchorX="left"
              anchorY="top"
              fontSize={0.15}
              maxWidth={size.width - 0.36}
              lineHeight={1.2}
              color="#1e293b"
            >
              {node.description}
            </Text>
          )
        ) : (
          <Text
            font={FONT_URL}
            position={[-0.36, -0.28, front]}
            anchorX="left"
            anchorY="middle"
            fontSize={0.14}
            maxWidth={1.6}
            color={theme.muted}
          >
            {subtitle ?? NODE_KINDS[node.kind].label}
            {!subtitle && node.config ? " · ejecutable" : ""}
            {!subtitle && node.link ? " · vinculado" : ""}
          </Text>
        )}

        {!isNote && (
          <>
            {/* Done badge. */}
            <mesh
              ref={badge}
              visible={false}
              position={[size.width / 2 - 0.16, size.height / 2 - 0.16, front + 0.03]}
            >
              <sphereGeometry args={[0.09, 16, 12]} />
              <meshBasicMaterial color="#10b981" toneMapped={false} />
            </mesh>
            {/* Error badge (last run failed here). */}
            <mesh
              ref={errorBadge}
              visible={false}
              position={[size.width / 2 - 0.16, size.height / 2 - 0.16, front + 0.03]}
            >
              <sphereGeometry args={[0.11, 16, 12]} />
              <meshBasicMaterial color={ERROR_COLOR} toneMapped={false} />
            </mesh>
            {/* Input port. */}
            <mesh position={[-PORT_OFFSET, 0, 0]}>
              <sphereGeometry args={[0.1, 16, 12]} />
              <meshStandardMaterial
                color={theme.card}
                emissive={kindColor}
                emissiveIntensity={0.4}
              />
            </mesh>
            {/* Output port: drag from it to connect. */}
            <mesh
              position={[PORT_OFFSET, 0, 0]}
              onPointerDown={(event) => editable && handlers.onConnectStart(event, node)}
              onPointerMove={handlers.onConnectMove}
              onPointerUp={handlers.onConnectEnd}
              onPointerOver={(event) => {
                if (!editable) return;
                event.stopPropagation();
                document.body.style.cursor = "crosshair";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "";
              }}
            >
              <sphereGeometry args={[editable ? 0.14 : 0.1, 16, 12]} />
              <meshStandardMaterial
                color={kindColor}
                emissive={kindColor}
                emissiveIntensity={0.5}
              />
            </mesh>
          </>
        )}
      </group>
    </group>
  );
});
