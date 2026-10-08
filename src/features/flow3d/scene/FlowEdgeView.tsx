import { memo, useEffect, useMemo, useRef, type ComponentRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Line, Text } from "@react-three/drei";
import { Quaternion, TubeGeometry, Vector3, type CubicBezierCurve3 } from "three";
import type { FlowEdge } from "../model";
import type { TimelineSpan } from "../timeline";
import type { PlaybackClock } from "../editor-store";
import type { SceneTheme } from "./theme";
import { FONT_URL } from "./font";

interface FlowEdgeViewProps {
  edge: FlowEdge;
  curve: CubicBezierCurve3;
  color: string;
  theme: SceneTheme;
  selected: boolean;
  /** Not taken by playback (another branch of a condition). */
  dimmed: boolean;
  span: TimelineSpan | undefined;
  clock: PlaybackClock;
  playing: () => boolean;
  onSelect: (event: ThreeEvent<MouseEvent>, edge: FlowEdge) => void;
}

const UP = new Vector3(0, 1, 0);

/**
 * An edge: a curve between ports, an arrowhead, an optional label and a
 * dashed overlay that marches once data has flowed through it.
 */
export const FlowEdgeView = memo(function FlowEdgeView({
  edge,
  curve,
  color,
  theme,
  selected,
  dimmed,
  span,
  clock,
  playing,
  onSelect,
}: FlowEdgeViewProps) {
  const flow = useRef<ComponentRef<typeof Line>>(null);
  const points = useMemo(() => curve.getPoints(48), [curve]);
  const hitGeometry = useMemo(() => new TubeGeometry(curve, 32, 0.14, 6, false), [curve]);
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry]);
  const arrow = useMemo(() => {
    const tangent = curve.getTangent(1).normalize();
    const position = curve.getPoint(1).clone().addScaledVector(tangent, -0.12);
    return { position, quaternion: new Quaternion().setFromUnitVectors(UP, tangent) };
  }, [curve]);
  const labelPosition = useMemo(() => curve.getPoint(0.5).add(new Vector3(0, 0.3, 0)), [curve]);

  useFrame((_, delta) => {
    const line = flow.current;
    if (!line) return;
    const reached = !!span && clock.time >= span.start;
    line.visible = reached;
    if (reached && playing()) {
      (line.material as unknown as { dashOffset: number }).dashOffset -= delta * 1.6;
    }
  });

  const style = edge.style;
  const baseColor = selected ? theme.primary : (style?.color ?? theme.muted);
  const width = style?.width ?? 2;

  return (
    <group>
      <Line
        points={points}
        color={baseColor}
        lineWidth={selected ? width + 1 : width}
        dashed={style?.dashed ?? false}
        dashSize={0.25}
        gapSize={0.18}
        transparent
        opacity={dimmed ? 0.25 : selected || style?.color ? 0.95 : 0.55}
      />
      <Line
        ref={flow}
        points={points}
        color={color}
        lineWidth={3}
        dashed
        dashSize={0.35}
        gapSize={0.22}
        visible={false}
      />
      {style?.arrow !== false && (
        <mesh position={arrow.position} quaternion={arrow.quaternion}>
          <coneGeometry args={[0.1, 0.26, 12]} />
          <meshBasicMaterial
            color={selected ? theme.primary : (style?.color ?? color)}
            transparent
            opacity={dimmed ? 0.35 : 0.9}
          />
        </mesh>
      )}
      {/* Wide invisible tube so the thin line is easy to click. */}
      <mesh
        geometry={hitGeometry}
        onClick={(event) => onSelect(event, edge)}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {edge.label && (
        <Billboard position={labelPosition}>
          <Text
            font={FONT_URL}
            fontSize={0.2}
            color={theme.foreground}
            outlineWidth={0.03}
            outlineColor={theme.background}
            anchorX="center"
            anchorY="middle"
          >
            {edge.label}
          </Text>
        </Billboard>
      )}
    </group>
  );
});
