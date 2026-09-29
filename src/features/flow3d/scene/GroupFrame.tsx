import { memo, useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Billboard, Line, Text } from "@react-three/drei";
import { Shape, ShapeGeometry } from "three";
import { DEFAULT_GROUP_COLOR, type FlowGroup, type FlowNode } from "../model";
import type { SceneTheme } from "./theme";
import { NODE_SIZE } from "./geometry";
import { FONT_URL } from "./font";

const PADDING = 0.7;
const GROUND_Y = -0.9;

function roundedShape(width: number, depth: number, radius: number): Shape {
  const x = -width / 2;
  const y = -depth / 2;
  const r = Math.min(radius, width / 2, depth / 2);
  return new Shape()
    .moveTo(x + r, y)
    .lineTo(x + width - r, y)
    .quadraticCurveTo(x + width, y, x + width, y + r)
    .lineTo(x + width, y + depth - r)
    .quadraticCurveTo(x + width, y + depth, x + width - r, y + depth)
    .lineTo(x + r, y + depth)
    .quadraticCurveTo(x, y + depth, x, y + depth - r)
    .lineTo(x, y + r)
    .quadraticCurveTo(x, y, x + r, y);
}

interface GroupFrameProps {
  group: FlowGroup;
  members: FlowNode[];
  theme: SceneTheme;
  selected: boolean;
  onSelect: (event: ThreeEvent<MouseEvent>, group: FlowGroup) => void;
  onToggle: (group: FlowGroup) => void;
}

/**
 * An expanded group: a translucent floor under its steps with its name.
 * Click the name to select the group, double-click to collapse it.
 */
export const GroupFrame = memo(function GroupFrame({
  group,
  members,
  theme,
  selected,
  onSelect,
  onToggle,
}: GroupFrameProps) {
  const bounds = useMemo(() => {
    const xs = members.map((n) => n.position[0]);
    const ys = members.map((n) => n.position[1]);
    const zs = members.map((n) => n.position[2]);
    const minX = Math.min(...xs) - NODE_SIZE.width / 2 - PADDING;
    const maxX = Math.max(...xs) + NODE_SIZE.width / 2 + PADDING;
    const minZ = Math.min(...zs) - PADDING - 0.4;
    const maxZ = Math.max(...zs) + PADDING + 0.4;
    return {
      minX,
      maxX,
      minZ,
      maxZ,
      y: Math.min(...ys) - NODE_SIZE.height / 2 - 0.12,
      top: Math.max(...ys) + NODE_SIZE.height / 2,
    };
  }, [members]);
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const geometry = useMemo(
    () => new ShapeGeometry(roundedShape(width, depth, 0.5), 6),
    [width, depth]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const outline = useMemo(
    () =>
      roundedShape(width, depth, 0.5)
        .getPoints(8)
        .map((p) => [p.x, 0, -p.y] as [number, number, number]),
    [width, depth]
  );
  const color = group.color ?? DEFAULT_GROUP_COLOR;
  // Raised groups (subflows) cast their outline on the floor to read their height.
  const lift = bounds.y - GROUND_Y;
  const center: [number, number, number] = [
    (bounds.minX + bounds.maxX) / 2,
    bounds.y,
    (bounds.minZ + bounds.maxZ) / 2,
  ];

  return (
    <group position={center} userData={{ flowGroupId: group.id }}>
      <mesh
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(event) => {
          if (event.delta > 4) return;
          onSelect(event, group);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onToggle(group);
        }}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={selected ? 0.16 : 0.08}
          depthWrite={false}
        />
      </mesh>
      <Line
        points={[...outline, outline[0]]}
        color={color}
        lineWidth={selected ? 2 : 1}
        transparent
        opacity={selected ? 0.9 : 0.45}
        dashed={!selected}
        dashSize={0.25}
        gapSize={0.15}
      />
      {lift > 0.4 && (
        <Line
          points={[...outline, outline[0]].map(
            ([x, , z]) => [x, -lift + 0.01, z] as [number, number, number]
          )}
          color={color}
          lineWidth={1}
          transparent
          opacity={0.3}
          dashed
          dashSize={0.2}
          gapSize={0.2}
        />
      )}
      <Billboard position={[-width / 2 + 0.2, bounds.top - bounds.y + 0.55, -depth / 2 + 0.2]}>
        <Text
          font={FONT_URL}
          fontSize={0.26}
          anchorX="left"
          anchorY="bottom"
          color={color}
          outlineWidth={0.012}
          outlineColor={theme.background}
          onClick={(event) => onSelect(event, group)}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onToggle(group);
          }}
          onPointerOver={() => {
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        >
          {/* Latin glyphs only: anything else makes troika fetch fallback fonts. */}
          {`${group.label || "Grupo"} · ${members.length} ${members.length === 1 ? "paso" : "pasos"}`}
        </Text>
      </Billboard>
    </group>
  );
});
