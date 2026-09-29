import { Environment, Lightformer } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";

/**
 * Studio lighting baked from local light panels (no HDR download): gives the
 * cards soft reflections. Rendered once.
 */
export function StudioEnvironment() {
  return (
    <Environment resolution={64} frames={1}>
      <Lightformer intensity={1.6} position={[0, 6, -6]} scale={[14, 5, 1]} />
      <Lightformer
        intensity={0.8}
        rotation-y={Math.PI / 2}
        position={[-8, 2, 0]}
        scale={[20, 2, 1]}
      />
      <Lightformer
        intensity={0.8}
        rotation-y={-Math.PI / 2}
        position={[8, 2, 0]}
        scale={[20, 2, 1]}
      />
      <Lightformer form="ring" intensity={1.2} position={[4, 6, 6]} scale={3} />
    </Environment>
  );
}

/** Glow on what is bright on purpose (packets, running steps). */
export function GlowEffects({ dark }: { dark: boolean }) {
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <Bloom
        mipmapBlur
        luminanceThreshold={1}
        luminanceSmoothing={0.25}
        intensity={dark ? 1.2 : 0.8}
      />
    </EffectComposer>
  );
}
