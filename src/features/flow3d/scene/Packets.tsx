import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  NormalBlending,
  Color,
  Matrix4,
  Quaternion,
  Vector3,
  type InstancedMesh,
  type CubicBezierCurve3,
} from "three";
import { sampleEdge, type TimelineSpan } from "../timeline";
import type { PlaybackClock } from "../editor-store";
import { easeInOut } from "./geometry";

interface PacketsProps {
  edges: Array<{ id: string; curve: CubicBezierCurve3; color: string }>;
  spans: Map<string, TimelineSpan>;
  clock: PlaybackClock;
  /** Additive glow washes out on light backgrounds. */
  dark: boolean;
  /** Bloom is on: push the core above 1 so it glows. */
  hdr?: boolean;
}

const hidden = new Matrix4().makeScale(0, 0, 0);
const scratch = {
  matrix: new Matrix4(),
  position: new Vector3(),
  quaternion: new Quaternion(),
  scale: new Vector3(),
};

/**
 * Data travelling along edges during playback. Two instanced meshes (core +
 * additive glow): one draw call each, however many edges the flow has.
 */
export function Packets({ edges, spans, clock, dark, hdr = false }: PacketsProps) {
  const core = useRef<InstancedMesh>(null);
  const glow = useRef<InstancedMesh>(null);
  const count = Math.max(1, edges.length);
  const colors = useMemo(() => edges.map((edge) => new Color(edge.color)), [edges]);

  useLayoutEffect(() => {
    for (const mesh of [core.current, glow.current]) {
      if (!mesh) continue;
      for (let i = 0; i < count; i++) {
        mesh.setMatrixAt(i, hidden);
        const color = (colors[i] ?? new Color("#ffffff")).clone();
        if (hdr && mesh === core.current) color.multiplyScalar(2.4);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [colors, count, hdr]);

  useFrame(() => {
    const coreMesh = core.current;
    const glowMesh = glow.current;
    if (!coreMesh || !glowMesh) return;
    const time = clock.time;
    edges.forEach((edge, i) => {
      const progress = sampleEdge(spans.get(edge.id), time);
      if (progress === null) {
        coreMesh.setMatrixAt(i, hidden);
        glowMesh.setMatrixAt(i, hidden);
        return;
      }
      edge.curve.getPointAt(easeInOut(progress), scratch.position);
      // Swell in and out at the ends of the trip.
      const size = Math.sin(Math.PI * Math.min(1, Math.max(0, progress))) * 0.6 + 0.4;
      scratch.scale.setScalar(size);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      coreMesh.setMatrixAt(i, scratch.matrix);
      glowMesh.setMatrixAt(i, scratch.matrix);
    });
    coreMesh.instanceMatrix.needsUpdate = true;
    glowMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={core} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.16, 16, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={glow} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.34, 16, 12]} />
        <meshBasicMaterial
          toneMapped={false}
          transparent
          opacity={dark ? 0.3 : 0.22}
          blending={dark ? AdditiveBlending : NormalBlending}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}
