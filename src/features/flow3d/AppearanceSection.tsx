import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  NODE_SHAPES,
  nodeColor,
  type EdgeStyle,
  type FlowEdge,
  type FlowNode,
  type NodeShape,
  type NodeStyle,
  type Vec3,
} from "./model";
import { nodeSize } from "./scene/geometry";

const SHAPE_LABELS: Record<NodeShape, string> = {
  card: "Tarjeta",
  box: "Cubo",
  sphere: "Esfera",
  cylinder: "Cilindro",
  cone: "Cono",
  capsule: "Cápsula",
  torus: "Anillo",
  diamond: "Diamante",
  gem: "Gema",
  disc: "Disco",
  plane: "Panel",
};

const LABEL_ITEMS = [
  { value: "auto", label: "Automática" },
  { value: "above", label: "Arriba" },
  { value: "below", label: "Abajo" },
  { value: "inside", label: "Dentro" },
  { value: "hidden", label: "Oculta" },
];

const CURVE_ITEMS = [
  { value: "auto", label: "Automática" },
  { value: "straight", label: "Recta" },
  { value: "smooth", label: "Curva" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const small = "h-7 text-xs md:text-xs";

/** Shape, size, color, icon, picture and label of a node. */
export function AppearanceSection({
  node,
  editable,
  onChange,
}: {
  node: FlowNode;
  editable: boolean;
  onChange: (patch: Partial<FlowNode>) => void;
}) {
  const style = node.style ?? {};
  const setStyle = (patch: Partial<NodeStyle>) => {
    const next: NodeStyle = { ...style, ...patch };
    for (const key of Object.keys(next) as Array<keyof NodeStyle>)
      if (next[key] === undefined || next[key] === "") delete next[key];
    onChange({ style: Object.keys(next).length > 0 ? next : undefined });
  };
  const size = nodeSize(node);
  const setAxis = (axis: 0 | 1 | 2, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const next = [...size] as Vec3;
    next[axis] = value;
    setStyle({ size: next });
  };
  const setPosition = (axis: 0 | 1 | 2, value: number) => {
    if (!Number.isFinite(value)) return;
    const next = [...node.position] as Vec3;
    next[axis] = value;
    onChange({ position: next });
  };

  return (
    <section className="space-y-2 border-t border-border/60 pt-2" data-appearance>
      <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        Apariencia
      </h4>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Forma">
          <Select
            items={NODE_SHAPES.map((shape) => ({ value: shape, label: SHAPE_LABELS[shape] }))}
            value={style.shape ?? "card"}
            disabled={!editable}
            onValueChange={(value) =>
              setStyle({
                shape: value === "card" ? undefined : (value as NodeShape),
                size: undefined,
              })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs" aria-label="Forma">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {NODE_SHAPES.map((shape) => (
                <SelectItem key={shape} value={shape} className="text-xs">
                  {SHAPE_LABELS[shape]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Color">
          <input
            type="color"
            aria-label="Color del nodo"
            className="h-7 w-full cursor-pointer rounded-md border border-input bg-transparent p-0.5"
            value={nodeColor(node)}
            disabled={!editable}
            onChange={(event) => onChange({ color: event.target.value })}
          />
        </Field>
      </div>

      <Field label="Tamaño (ancho · alto · fondo)">
        <div className="grid grid-cols-3 gap-1.5">
          {([0, 1, 2] as const).map((axis) => (
            <Input
              key={axis}
              type="number"
              min={0.05}
              step={0.1}
              aria-label={["Ancho", "Alto", "Fondo"][axis]}
              className={small}
              value={Math.round(size[axis] * 100) / 100}
              disabled={!editable}
              onChange={(event) => setAxis(axis, Number(event.target.value))}
            />
          ))}
        </div>
      </Field>

      <Field label="Posición (x · y altura · z fondo)">
        <div className="grid grid-cols-3 gap-1.5">
          {([0, 1, 2] as const).map((axis) => (
            <Input
              key={axis}
              type="number"
              step={0.5}
              aria-label={["Posición x", "Posición y", "Posición z"][axis]}
              className={small}
              value={Math.round(node.position[axis] * 100) / 100}
              disabled={!editable}
              onChange={(event) => setPosition(axis, Number(event.target.value))}
            />
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Icono (emoji o texto)">
          <Input
            className={small}
            value={style.icon ?? ""}
            placeholder="🧠  DB  ⚙️"
            maxLength={8}
            disabled={!editable}
            onChange={(event) => setStyle({ icon: event.target.value.trim() || undefined })}
          />
        </Field>
        <Field label="Etiqueta">
          <Select
            items={LABEL_ITEMS}
            value={style.label ?? "auto"}
            disabled={!editable}
            onValueChange={(value) =>
              setStyle({ label: value === "auto" ? undefined : (value as NodeStyle["label"]) })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs" aria-label="Etiqueta">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {LABEL_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value} className="text-xs">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Imagen / textura (ruta del proyecto o URL)">
        <Input
          className={small}
          value={style.image ?? ""}
          placeholder="assets/logo.png"
          disabled={!editable}
          onChange={(event) => setStyle({ image: event.target.value.trim() || undefined })}
        />
      </Field>

      <div className="grid grid-cols-2 items-end gap-2">
        <Field label={`Opacidad · ${Math.round((style.opacity ?? 1) * 100)}%`}>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            aria-label="Opacidad"
            className="w-full accent-primary"
            value={style.opacity ?? 1}
            disabled={!editable}
            onChange={(event) => {
              const value = Number(event.target.value);
              setStyle({ opacity: value >= 1 ? undefined : value });
            }}
          />
        </Field>
        <label className="flex h-7 items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={style.glow ?? false}
            disabled={!editable}
            onChange={(event) => setStyle({ glow: event.target.checked || undefined })}
          />
          Brillo
        </label>
      </div>
    </section>
  );
}

/** Color, line and curve of a connection. */
export function EdgeAppearance({
  edge,
  editable,
  onChange,
}: {
  edge: FlowEdge;
  editable: boolean;
  onChange: (patch: Partial<FlowEdge>) => void;
}) {
  const style = edge.style ?? {};
  const setStyle = (patch: Partial<EdgeStyle>) => {
    const next: EdgeStyle = { ...style, ...patch };
    for (const key of Object.keys(next) as Array<keyof EdgeStyle>)
      if (next[key] === undefined) delete next[key];
    onChange({ style: Object.keys(next).length > 0 ? next : undefined });
  };
  return (
    <section className="space-y-2 border-t border-border/60 pt-2" data-edge-appearance>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Color">
          <input
            type="color"
            aria-label="Color de la conexión"
            className="h-7 w-full cursor-pointer rounded-md border border-input bg-transparent p-0.5"
            value={style.color ?? "#94a3b8"}
            disabled={!editable}
            onChange={(event) => setStyle({ color: event.target.value })}
          />
        </Field>
        <Field label="Trazo">
          <Select
            items={CURVE_ITEMS}
            value={style.curve ?? "auto"}
            disabled={!editable}
            onValueChange={(value) =>
              setStyle({ curve: value === "auto" ? undefined : (value as EdgeStyle["curve"]) })
            }
          >
            <SelectTrigger size="sm" className="w-full text-xs" aria-label="Trazo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {CURVE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value} className="text-xs">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label={`Grosor · ${style.width ?? 2}px`}>
        <input
          type="range"
          min={1}
          max={8}
          step={0.5}
          aria-label="Grosor"
          className="w-full accent-primary"
          value={style.width ?? 2}
          disabled={!editable}
          onChange={(event) => setStyle({ width: Number(event.target.value) })}
        />
      </Field>
      <div className="flex gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={style.dashed ?? false}
            disabled={!editable}
            onChange={(event) => setStyle({ dashed: event.target.checked || undefined })}
          />
          Discontinua
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={style.arrow !== false}
            disabled={!editable}
            onChange={(event) => setStyle({ arrow: event.target.checked ? undefined : false })}
          />
          Flecha
        </label>
      </div>
    </section>
  );
}
