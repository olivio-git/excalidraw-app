import { memo, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { Canvas, useThree } from "@react-three/fiber";
import { Billboard, CameraControls, Text } from "@react-three/drei";
import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import { Maximize, RefreshCw, Share2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useTabContext } from "@/core/tabs/hooks/use-tab-context";
import { useWorkspaceReferences } from "@/core/shell/hooks/useWorkspaceReferences";
import { createFileReference, openFileReference } from "@/core/shell/services/file-navigation";
import { useThemeStore } from "@/stores/themeStore";
import { notify } from "@/shared/lib/notify";
import { cn } from "@/shared/lib/utils";
import { FONT_URL } from "@/features/flow3d/scene/font";
import {
  buildGraph,
  KIND_COLORS,
  layoutGraph,
  neighbours,
  type GraphNode,
  type GraphNodeKind,
  type WorkspaceGraph,
} from "./graph";

type Controls = ComponentRef<typeof CameraControls>;
type Vec3 = [number, number, number];

const KINDS: GraphNodeKind[] = ["note", "markdown", "diagram", "flow", "other"];

function Edges({
  graph,
  positions,
  focus,
  dark,
}: {
  graph: WorkspaceGraph;
  positions: Record<string, Vec3>;
  focus: Set<string> | null;
  dark: boolean;
}) {
  // All links in one draw call; the focused ones get their own brighter pass.
  const [base, highlighted] = useMemo(() => {
    const make = (edges: WorkspaceGraph["edges"]) => {
      const geometry = new BufferGeometry();
      const points: number[] = [];
      const colors: number[] = [];
      for (const edge of edges) {
        const a = positions[edge.from];
        const b = positions[edge.to];
        if (!a || !b) continue;
        points.push(...a, ...b);
        const from = new Color(
          KIND_COLORS[graph.nodes.find((n) => n.id === edge.from)?.kind ?? "other"]
        );
        const to = new Color(
          KIND_COLORS[graph.nodes.find((n) => n.id === edge.to)?.kind ?? "other"]
        );
        colors.push(from.r, from.g, from.b, to.r, to.g, to.b);
      }
      geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
      return geometry;
    };
    const lit = focus ? graph.edges.filter((e) => focus.has(e.from) && focus.has(e.to)) : [];
    return [make(graph.edges), make(lit)];
  }, [graph, positions, focus]);
  useEffect(
    () => () => {
      base.dispose();
      highlighted.dispose();
    },
    [base, highlighted]
  );
  return (
    <>
      <lineSegments geometry={base}>
        <lineBasicMaterial vertexColors transparent opacity={focus ? 0.08 : dark ? 0.35 : 0.45} />
      </lineSegments>
      {focus && (
        <lineSegments geometry={highlighted}>
          <lineBasicMaterial vertexColors transparent opacity={0.95} />
        </lineSegments>
      )}
    </>
  );
}

const GraphNodeMesh = memo(function GraphNodeMesh({
  node,
  position,
  dimmed,
  selected,
  showLabel,
  dark,
  onSelect,
  onOpen,
  onHover,
}: {
  node: GraphNode;
  position: Vec3;
  dimmed: boolean;
  selected: boolean;
  showLabel: boolean;
  dark: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const radius = 0.32 + Math.min(0.6, Math.sqrt(node.degree) * 0.14);
  const color = KIND_COLORS[node.kind];
  return (
    <group position={position}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.id);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onOpen(node.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHover(node.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "";
        }}
      >
        <sphereGeometry args={[radius, 24, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.8 : 0.25}
          roughness={0.35}
          // Always transparent: toggling it would need a shader recompile.
          transparent
          depthWrite={!dimmed}
          opacity={dimmed ? 0.15 : 1}
        />
      </mesh>
      {selected && (
        <mesh>
          <sphereGeometry args={[radius * 1.6, 24, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} />
        </mesh>
      )}
      {showLabel && !dimmed && (
        <Billboard position={[0, radius + 0.28, 0]}>
          <Text
            font={FONT_URL}
            fontSize={0.42}
            anchorY="bottom"
            color={dark ? "#e2e8f0" : "#0f172a"}
            outlineWidth={0.02}
            outlineColor={dark ? "#0b0f17" : "#ffffff"}
            maxWidth={6}
          >
            {node.label}
          </Text>
        </Billboard>
      )}
    </group>
  );
});

function Fit({
  controls,
  positions,
  request,
}: {
  controls: React.RefObject<Controls | null>;
  positions: Record<string, Vec3>;
  request: number;
}) {
  const size = useThree((s) => s.size);
  useEffect(() => {
    const values = Object.values(positions);
    if (!controls.current || values.length === 0) return;
    // Distance that fits the bounding sphere in the vertical field of view.
    const radius = Math.max(3, ...values.map((p) => Math.hypot(p[0], p[1], p[2])));
    const distance = (radius / Math.sin((45 * Math.PI) / 360)) * 1.05;
    const [x, y, z] = [0.2, 0.55, 1].map((v) => v / Math.hypot(0.2, 0.55, 1));
    void controls.current.setLookAt(x * distance, y * distance, z * distance, 0, 0, 0, request > 0);
  }, [controls, positions, request, size.width]);
  return null;
}

/** Tab with the workspace's files and links as an explorable 3D graph. */
export default function KnowledgeGraph() {
  const { t } = useTranslation("common");
  const { isActive, isVisible } = useTabContext();
  const visible = isVisible ?? isActive;
  const { index, loading, workspace, refresh } = useWorkspaceReferences();
  const dark = useThemeStore((s) => s.resolvedTheme) === "dark";
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [fit, setFit] = useState(0);
  const controls = useRef<Controls | null>(null);

  const graph = useMemo(() => buildGraph(index?.references ?? []), [index]);
  const positions = useMemo(() => layoutGraph(graph), [graph]);
  const focus = useMemo(() => {
    const id = hovered ?? selected;
    if (id) return new Set([id, ...neighbours(graph, id)]);
    if (!filter.trim()) return null;
    const wanted = filter.trim().toLowerCase();
    return new Set(
      graph.nodes.filter((n) => n.label.toLowerCase().includes(wanted)).map((n) => n.id)
    );
  }, [graph, hovered, selected, filter]);
  // Labels for the busiest files, and for whatever is in focus.
  const labelled = useMemo(() => {
    const top = [...graph.nodes].sort((a, b) => b.degree - a.degree).slice(0, 12);
    return new Set([...top.map((n) => n.id), ...(focus ?? [])]);
  }, [graph, focus]);

  const open = (id: string) => {
    void openFileReference(createFileReference(id, workspace), id, {}).catch((error: unknown) =>
      notify(String(error), { type: "error" })
    );
  };
  const selectedNode = graph.nodes.find((n) => n.id === selected);
  const background = dark ? "#11151c" : "#f8fafc";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-knowledge-graph>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-2 text-xs">
        <Share2 className="size-4 text-muted-foreground" />
        <span className="font-medium">{t("graph.title")}</span>
        <span className="text-muted-foreground">
          {t("graph.summary", { files: graph.nodes.length, links: graph.edges.length })}
        </span>
        <div className="flex-1" />
        <Input
          aria-label={t("graph.filter")}
          placeholder={t("graph.filter")}
          className="h-7 w-44 text-xs md:text-xs"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("graph.fit")}
          title={t("graph.fit")}
          onClick={() => setFit((n) => n + 1)}
        >
          <Maximize />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("graph.refresh")}
          title={t("graph.refresh")}
          onClick={refresh}
        >
          <RefreshCw className={cn(loading && "animate-spin")} />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {graph.nodes.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {!workspace ? t("graph.noWorkspace") : loading ? t("graph.loading") : t("graph.empty")}
          </p>
        ) : (
          <Canvas
            frameloop={visible ? "demand" : "never"}
            dpr={[1, 1.75]}
            camera={{ position: [8, 12, 22], fov: 45, near: 0.1, far: 600 }}
            onPointerMissed={() => setSelected(null)}
            data-graph-canvas
          >
            <color attach="background" args={[background]} />
            <fog attach="fog" args={[background, 40, 160]} />
            <ambientLight intensity={dark ? 0.6 : 0.9} />
            <directionalLight position={[10, 20, 10]} intensity={1.1} />
            <CameraControls
              ref={controls}
              makeDefault
              smoothTime={0.25}
              minDistance={2}
              maxDistance={200}
            />
            <Fit controls={controls} positions={positions} request={fit} />
            <Edges graph={graph} positions={positions} focus={focus} dark={dark} />
            {graph.nodes.map((node) => (
              <GraphNodeMesh
                key={node.id}
                node={node}
                position={positions[node.id]}
                dimmed={focus !== null && !focus.has(node.id)}
                selected={selected === node.id}
                showLabel={labelled.has(node.id)}
                dark={dark}
                onSelect={setSelected}
                onOpen={open}
                onHover={setHovered}
              />
            ))}
          </Canvas>
        )}
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-2 rounded-lg bg-popover/85 px-2 py-1 text-[11px] shadow-sm backdrop-blur">
          {KINDS.map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: KIND_COLORS[kind] }} />
              {t(`graph.kinds.${kind}`)}
            </span>
          ))}
        </div>
        {selectedNode && (
          <div className="absolute top-2 right-2 w-64 space-y-2 rounded-lg border border-border bg-popover/95 p-3 text-xs shadow-lg backdrop-blur">
            <p className="flex items-center gap-2 font-medium">
              <span
                className="size-2.5 rounded-full"
                style={{ background: KIND_COLORS[selectedNode.kind] }}
              />
              <span className="truncate">{selectedNode.label}</span>
            </p>
            <p className="break-all text-[11px] text-muted-foreground">{selectedNode.id}</p>
            <p className="text-muted-foreground">
              {t("graph.links", { count: selectedNode.degree })}
            </p>
            <ul className="max-h-40 space-y-0.5 overflow-auto">
              {[...neighbours(graph, selectedNode.id)].map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className="w-full truncate rounded px-1 py-0.5 text-left hover:bg-accent"
                    onClick={() => setSelected(id)}
                  >
                    {id.split("/").pop()}
                  </button>
                </li>
              ))}
            </ul>
            <Button size="xs" className="w-full" onClick={() => open(selectedNode.id)}>
              {t("graph.open")}
            </Button>
          </div>
        )}
        <p className="pointer-events-none absolute right-2 bottom-2 hidden text-[11px] text-muted-foreground md:block">
          {t("graph.hint")}
        </p>
      </div>
    </div>
  );
}
