import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Outlines, Text } from "@react-three/drei";
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Group,
  type Mesh,
  type MeshStandardMaterial,
} from "three";
import { nodeColor, type FlowNode, type NodeShape, type Vec3 } from "../model";
import { sampleNode, type TimelineSpan } from "../timeline";
import type { PlaybackClock } from "../editor-store";
import type { SceneTheme } from "./theme";
import type { NodeHandlers } from "./FlowNodeView";
import { nodeSize } from "./geometry";
import { iconTexture, roundShadowTexture, useImageTexture } from "./node-textures";
import { FONT_URL } from "./font";

// Unit geometries (1×1×1 bounding box), shared by every node and scaled to its size.
const GEOMETRIES: Record<Exclude<NodeShape, "card">, { geometry: BufferGeometry; scale?: Vec3 }> = {
  box: { geometry: new BoxGeometry(1, 1, 1) },
  sphere: { geometry: new SphereGeometry(0.5, 40, 28) },
  cylinder: { geometry: new CylinderGeometry(0.5, 0.5, 1, 40) },
  cone: { geometry: new ConeGeometry(0.5, 1, 40) },
  // Total height 1 with radius 0.25 → scale x/z by 2 to fill the box.
  capsule: { geometry: new CapsuleGeometry(0.25, 0.5, 8, 24), scale: [2, 1, 2] },
  // Outer diameter 1, tube 0.3 thick.
  torus: { geometry: new TorusGeometry(0.35, 0.15, 20, 48), scale: [1, 1, 1 / 0.3] },
  diamond: { geometry: new OctahedronGeometry(0.5) },
  gem: { geometry: new IcosahedronGeometry(0.5, 0) },
  disc: { geometry: new CylinderGeometry(0.5, 0.5, 1, 48) },
  plane: { geometry: new BoxGeometry(1, 1, 1) },
};
const shadowGeometry = new PlaneGeometry(1, 1);
const ERROR_COLOR = "#ef4444";
const FLOOR_Y = -0.89;

interface ShapeNodeViewProps {
  node: FlowNode;
  theme: SceneTheme;
  selected: boolean;
  highlighted: boolean;
  editable: boolean;
  failed?: boolean;
  subtitle?: string;
  span: TimelineSpan | undefined;
  hdr?: boolean;
  shadow?: boolean;
  clock: PlaybackClock;
  handlers: NodeHandlers;
}

/**
 * A node drawn as any 3D form (sphere, cylinder, cube, gem…) with an optional
 * icon or picture: neurons, servers, bricks, planets. The label always faces
 * the camera, so it reads from any angle.
 */
export function ShapeNodeView({
  node,
  theme,
  selected,
  highlighted,
  editable,
  failed = false,
  subtitle,
  span,
  hdr = false,
  shadow = false,
  clock,
  handlers,
}: ShapeNodeViewProps) {
  const lift = useRef<Group>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const badge = useRef<Mesh>(null);
  const errorBadge = useRef<Mesh>(null);
  const shape = (node.style?.shape ?? "box") as Exclude<NodeShape, "card">;
  const { geometry, scale: unitScale } = GEOMETRIES[shape] ?? GEOMETRIES.box;
  const size = nodeSize(node);
  const scale = useMemo<Vec3>(
    () => [
      size[0] * (unitScale?.[0] ?? 1),
      size[1] * (unitScale?.[1] ?? 1),
      size[2] * (unitScale?.[2] ?? 1),
    ],
    [size, unitScale]
  );
  const color = nodeColor(node);
  const baseColor = useMemo(() => new Color(color), [color]);
  const picture = useImageTexture(node.style?.image);
  const icon = node.style?.icon;
  const iconMap = useMemo(() => (icon ? iconTexture(icon) : null), [icon]);
  const opacity = node.style?.opacity ?? 1;
  const glow = node.style?.glow ?? false;
  const restGlow = glow ? (hdr ? 1.2 : 0.55) : theme.dark ? 0.1 : 0.04;
  const labelPlace = node.style?.label ?? "auto";
  const top = size[1] / 2;

  useFrame(({ invalidate }, delta) => {
    const { phase, progress } = sampleNode(span, clock.time);
    const active = phase === "active";
    const group = lift.current;
    const targetLift = active ? 0.3 : 0;
    if (group) {
      const next = group.position.y + (targetLift - group.position.y) * Math.min(1, delta * 10);
      group.position.y = Math.abs(next - targetLift) < 0.001 ? targetLift : next;
      if (group.position.y !== targetLift) invalidate();
    }
    if (material.current) {
      material.current.emissiveIntensity = active
        ? (hdr ? 1.8 : 0.7) + 0.4 * Math.sin(progress * Math.PI * 4)
        : phase === "done"
          ? Math.max(restGlow, 0.25)
          : restGlow;
    }
    if (badge.current) badge.current.visible = phase === "done" && !failed;
    if (errorBadge.current) errorBadge.current.visible = failed && phase === "done";
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
  const labelY = labelPlace === "below" ? -top - 0.32 : top + 0.34;
  const iconSize = Math.min(size[0], size[1]) * 0.62;
  // Billboards face the camera, so their local +z points at it: drawing the icon (or an
  // inside label) just past the shape's surface keeps it in front without showing through others.
  // Round shapes reach max/2 in every direction; boxy ones up to their half diagonal.
  const round = shape === "sphere" || shape === "gem" || shape === "diamond";
  const front = (round ? Math.max(...size) : Math.hypot(...size)) / 2 + 0.03;
  // Flat panels: the icon is printed on the face (like a screen), not floating.
  const flat = shape === "plane";

  return (
    <group position={node.position} userData={{ flowNodeId: node.id }}>
      {shadow && (
        <mesh
          geometry={shadowGeometry}
          position={[0, FLOOR_Y - node.position[1], 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[size[0] * 1.6, size[2] * 1.6, 1]}
          raycast={() => null}
        >
          <meshBasicMaterial
            map={roundShadowTexture()}
            transparent
            depthWrite={false}
            opacity={Math.max(0.06, (theme.dark ? 0.5 : 0.25) - node.position[1] * 0.05)}
          />
        </mesh>
      )}
      <group ref={lift}>
        <mesh geometry={geometry} scale={scale} {...bodyEvents}>
          <meshStandardMaterial
            ref={material}
            color={picture ? "#ffffff" : baseColor}
            map={picture}
            emissive={baseColor}
            emissiveIntensity={restGlow}
            roughness={shape === "gem" || shape === "diamond" ? 0.18 : 0.38}
            metalness={shape === "gem" || shape === "diamond" ? 0.35 : 0.08}
            envMapIntensity={0.9}
            transparent={opacity < 1}
            opacity={opacity}
            toneMapped={!glow}
          />
          {outline && <Outlines thickness={selected ? 0.05 : 0.03} color={outline} />}
        </mesh>

        {iconMap &&
          (flat ? (
            <mesh position={[0, 0, size[2] / 2 + 0.01]} raycast={() => null}>
              <planeGeometry args={[iconSize, iconSize]} />
              <meshBasicMaterial map={iconMap} transparent toneMapped={false} />
            </mesh>
          ) : (
            // In front of its own shape, facing the camera, so it reads from any side.
            <Billboard>
              <mesh
                position={[0, labelPlace === "inside" ? iconSize * 0.18 : 0, front]}
                raycast={() => null}
              >
                <planeGeometry args={[iconSize, iconSize]} />
                <meshBasicMaterial map={iconMap} transparent toneMapped={false} />
              </mesh>
            </Billboard>
          ))}

        {labelPlace !== "hidden" && (node.label || subtitle) && (
          <Billboard position={[0, labelPlace === "inside" ? 0 : labelY, 0]}>
            <Text
              font={FONT_URL}
              position={
                labelPlace === "inside"
                  ? [0, iconMap ? -iconSize * 0.38 : 0, front + 0.01]
                  : [0, 0, 0]
              }
              fontSize={0.22}
              maxWidth={Math.max(2.4, size[0] * 1.6)}
              textAlign="center"
              anchorX="center"
              anchorY="middle"
              color={theme.foreground}
              outlineWidth={0.025}
              outlineColor={theme.background}
            >
              {node.label || " "}
              {subtitle ? `\n${subtitle}` : ""}
            </Text>
          </Billboard>
        )}

        <mesh ref={badge} visible={false} position={[size[0] / 2, top, 0]}>
          <sphereGeometry args={[0.09, 16, 12]} />
          <meshBasicMaterial color="#10b981" toneMapped={false} />
        </mesh>
        <mesh ref={errorBadge} visible={false} position={[size[0] / 2, top, 0]}>
          <sphereGeometry args={[0.11, 16, 12]} />
          <meshBasicMaterial color={ERROR_COLOR} toneMapped={false} />
        </mesh>

        {editable && (selected || highlighted) && (
          // Output port (on hover/selection, so dense diagrams stay clean): drag from it to connect.
          <mesh
            position={[size[0] / 2 + 0.12, 0, 0]}
            onPointerDown={(event) => handlers.onConnectStart(event, node)}
            onPointerMove={handlers.onConnectMove}
            onPointerUp={handlers.onConnectEnd}
            onPointerOver={(event) => {
              event.stopPropagation();
              document.body.style.cursor = "crosshair";
            }}
            onPointerOut={() => {
              document.body.style.cursor = "";
            }}
          >
            <sphereGeometry args={[0.1, 16, 12]} />
            <meshStandardMaterial color={baseColor} emissive={baseColor} emissiveIntensity={0.5} />
          </mesh>
        )}
      </group>
    </group>
  );
}
